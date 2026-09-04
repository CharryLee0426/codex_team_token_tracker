import Foundation

struct RepositoryLoadTicket: Equatable, Sendable {
  let scope: UsageScope
  let organizationID: String?
  fileprivate let generation: UInt64
}

/// Owns latest-load authority and the cancellation hook for each scope.
/// Replacing or invalidating a load invokes its hook before authority is transferred.
@MainActor
final class RepositoryLoadCoordinator {
  private struct ActiveLoad {
    let ticket: RepositoryLoadTicket
    var cancel: (() -> Void)?
  }

  private var nextGeneration: UInt64 = 0
  private var active: [UsageScope: ActiveLoad] = [:]

  func begin(scope: UsageScope, organizationID: String?) -> RepositoryLoadTicket {
    let previous = active.removeValue(forKey: scope)
    previous?.cancel?()
    nextGeneration &+= 1
    let ticket = RepositoryLoadTicket(
      scope: scope,
      organizationID: organizationID,
      generation: nextGeneration
    )
    active[scope] = ActiveLoad(ticket: ticket)
    return ticket
  }

  @discardableResult
  func registerCancellation(
    for ticket: RepositoryLoadTicket,
    _ cancellation: @escaping () -> Void
  ) -> Bool {
    guard var load = active[ticket.scope], load.ticket == ticket else {
      cancellation()
      return false
    }
    load.cancel?()
    load.cancel = cancellation
    active[ticket.scope] = load
    return true
  }

  func isCurrent(_ ticket: RepositoryLoadTicket) -> Bool {
    active[ticket.scope]?.ticket == ticket
  }

  func requireCurrent(_ ticket: RepositoryLoadTicket) throws {
    guard isCurrent(ticket) else { throw CancellationError() }
  }

  func invalidate(_ ticket: RepositoryLoadTicket) {
    guard active[ticket.scope]?.ticket == ticket else { return }
    let load = active.removeValue(forKey: ticket.scope)
    load?.cancel?()
  }

  func invalidate(scope: UsageScope) {
    let load = active.removeValue(forKey: scope)
    load?.cancel?()
  }

  func invalidateAll() {
    let loads = Array(active.values)
    active.removeAll()
    loads.forEach { $0.cancel?() }
  }
}

/// A one-shot async result whose cancellation always resumes its checked continuation.
@MainActor
final class PendingLoadResult<Value: Sendable> {
  private enum State {
    case pending
    case waiting(CheckedContinuation<Value, Error>)
    case finished(Result<Value, Error>)
    case consumed
  }

  private var state: State = .pending

  func wait() async throws -> Value {
    try Task.checkCancellation()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        switch state {
        case .pending:
          state = .waiting(continuation)
        case .finished(let result):
          state = .consumed
          continuation.resume(with: result)
        case .waiting, .consumed:
          preconditionFailure("PendingLoadResult supports exactly one waiter")
        }
      }
    } onCancel: { [weak self] in
      Task { @MainActor in
        self?.cancel()
      }
    }
  }

  @discardableResult
  func resume(returning value: Value) -> Bool {
    finish(.success(value))
  }

  @discardableResult
  func resume(throwing error: Error) -> Bool {
    finish(.failure(error))
  }

  @discardableResult
  func cancel() -> Bool {
    finish(.failure(CancellationError()))
  }

  private func finish(_ result: Result<Value, Error>) -> Bool {
    switch state {
    case .pending:
      state = .finished(result)
      return true
    case .waiting(let continuation):
      state = .consumed
      continuation.resume(with: result)
      return true
    case .finished, .consumed:
      return false
    }
  }
}

/// Clerk organization activation mutates process-wide session state, so switches must not overlap.
@MainActor
final class OrganizationActivationQueue {
  private var tail: Task<Void, Never>?
  private var operations: [UUID: Task<String, Error>] = [:]

  func run(
    _ operation: @escaping @MainActor @Sendable () async throws -> String
  ) async throws -> String {
    let predecessor = tail
    let task = Task { @MainActor in
      if let predecessor { await predecessor.value }
      try Task.checkCancellation()
      return try await operation()
    }
    let id = UUID()
    operations[id] = task
    tail = Task { @MainActor in
      _ = await task.result
    }
    defer { operations[id] = nil }

    return try await withTaskCancellationHandler {
      try await task.value
    } onCancel: {
      task.cancel()
    }
  }

  func cancelAll() {
    operations.values.forEach { $0.cancel() }
  }
}
