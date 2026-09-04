package dev.chenli.codextracker.data

import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal class OrganizationActivationCoordinator {
  private val mutex = Mutex()
  private val generation = AtomicLong()

  suspend fun <T> activate(
    clerkOrgId: String,
    operation: suspend OrganizationActivationScope.() -> T,
  ): T {
    require(clerkOrgId.isNotBlank())
    currentCoroutineContext().ensureActive()
    val requestGeneration = generation.incrementAndGet()
    val callerJob = checkNotNull(currentCoroutineContext()[Job])

    return mutex.withLock {
      val activation =
        OrganizationActivationScope(
          requestedClerkOrgId = clerkOrgId,
          requestGeneration = requestGeneration,
          latestGeneration = generation,
          callerJob = callerJob,
        )
      activation.checkpointRequest()
      val result = withContext(NonCancellable) { activation.operation() }
      callerJob.ensureActive()
      activation.checkpointRequest()
      result
    }
  }

  fun invalidate() {
    generation.incrementAndGet()
  }
}

internal class OrganizationActivationScope(
  val requestedClerkOrgId: String,
  private val requestGeneration: Long,
  private val latestGeneration: AtomicLong,
  private val callerJob: Job,
) {
  fun checkpointRequest() {
    if (!callerJob.isActive || latestGeneration.get() != requestGeneration) {
      throw CancellationException("Organization activation was superseded")
    }
  }

  fun checkpoint(activeClerkOrgId: String?) {
    checkpointRequest()
    check(activeClerkOrgId == requestedClerkOrgId) {
      "Active organization authority changed"
    }
  }
}
