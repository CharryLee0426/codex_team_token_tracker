import Foundation
import XCTest
@testable import CodexTracker

final class ConvexWireModelTests: XCTestCase {
  private let positiveInfinity = #"{"$float":"AAAAAAAA8H8="}"#
  private let negativeInfinity = #"{"$float":"AAAAAAAA8P8="}"#
  private let nan = #"{"$float":"AAAAAAAA+H8="}"#

  func testHourlyWireResponseDecodesTaggedConvexFloatsWithoutTerminatingPage() throws {
    let value = positiveInfinity
    let json = """
      {
        "rows": [{
          "h": \(value), "u": "user-a", "d": "device-a",
          "i": \(value), "c": \(value), "w": \(value), "o": \(value),
          "r": \(value), "t": \(value), "q": \(value), "usd": \(value),
          "m": [{
            "model": "gpt-5.6-sol", "agent": "codex",
            "i": \(value), "c": \(value), "w": \(value), "o": \(value),
            "r": \(value), "t": \(value), "q": \(value), "usd": \(value)
          }]
        }],
        "users": [{"id": "user-a", "name": "Alex", "email": null, "imageUrl": null}]
      }
      """

    let response = try decode(ConvexHourlyResponse.self, json)
    let row = try XCTUnwrap(response.rows.first?.domain)
    let model = try XCTUnwrap(row.m.first)

    XCTAssertEqual([row.h, row.i, row.c, row.w, row.o, row.r, row.t, row.q, row.usd], Array(repeating: 0, count: 9))
    XCTAssertEqual([model.i, model.c, model.w, model.o, model.r, model.t, model.q, model.usd], Array(repeating: 0, count: 8))
  }

  func testSessionWireResponseDecodesTaggedConvexFloats() throws {
    let value = negativeInfinity
    let json = """
      {
        "id": "session-a", "user": {"id": "user-a", "name": null, "email": "a@example.com", "imageUrl": null},
        "deviceId": "device-a", "sessionId": "upstream-a", "agent": "codex", "model": "gpt-5.6-sol",
        "projectName": null, "startedAt": \(value), "lastActivityAt": \(value),
        "input": \(value), "cached": \(value), "cacheWrite": \(value), "output": \(value),
        "reasoning": \(value), "total": \(value), "requests": \(value), "cost": \(value),
        "source": null, "cliVersion": null
      }
      """

    let session = try decode(ConvexSessionItem.self, json).domain

    XCTAssertEqual(
      [session.startedAt, session.lastActivityAt, session.input, session.cached, session.cacheWrite,
       session.output, session.reasoning, session.total, session.requests, session.cost],
      Array(repeating: 0, count: 10)
    )
  }

  func testLiveDeviceAndMemberWireResponsesDecodeTaggedAndOptionalConvexFloats() throws {
    let liveJSON = """
      {
        "sessionId": null, "model": "gpt-5.6-sol",
        "tokensPerSecond": \(positiveInfinity), "lastEventAt": \(negativeInfinity),
        "todayTotal": \(nan), "todayCost": \(positiveInfinity), "updatedAt": \(negativeInfinity)
      }
      """
    let live = try decode(ConvexLiveSnapshot.self, liveJSON).domain
    XCTAssertEqual([live.tokensPerSecond, live.lastEventAt, live.todayTotal, live.todayCost, live.updatedAt], [0, 0, 0, 0, 0])

    let deviceJSON = """
      {
        "id": "device-a", "name": "Mac", "platform": "darwin", "hostname": null,
        "appVersion": null, "timezone": null, "createdAt": \(positiveInfinity),
        "lastSeenAt": \(negativeInfinity), "live": \(liveJSON), "logins": \(nan)
      }
      """
    let device = try decode(ConvexDeviceItem.self, deviceJSON).domain
    XCTAssertEqual([device.createdAt, device.lastSeenAt, device.logins], [0, 0, 0])
    XCTAssertNotNil(device.live)

    let memberJSON = """
      {
        "id": "user-a", "name": "Alex", "email": null, "imageUrl": null, "role": "org:member",
        "joinedAt": \(positiveInfinity), "deviceCount": \(nan), "lastSeenAt": null, "live": \(liveJSON)
      }
      """
    let member = try decode(ConvexMemberItem.self, memberJSON).domain
    XCTAssertEqual([member.joinedAt, member.deviceCount], [0, 0])
    XCTAssertNil(member.lastSeenAt)
    XCTAssertNotNil(member.live)
  }

  func testWireModelsContinueToDecodeOrdinaryJSONNumbers() throws {
    let json = """
      {
        "sessionId": "session-a", "model": null,
        "tokensPerSecond": 12.5, "lastEventAt": 1000,
        "todayTotal": 42, "todayCost": 0.25, "updatedAt": 2000
      }
      """

    let live = try decode(ConvexLiveSnapshot.self, json).domain

    XCTAssertEqual(live.tokensPerSecond, 12.5)
    XCTAssertEqual(live.lastEventAt, 1000)
    XCTAssertEqual(live.todayTotal, 42)
    XCTAssertEqual(live.todayCost, 0.25)
    XCTAssertEqual(live.updatedAt, 2000)
  }

  private func decode<Value: Decodable>(_ type: Value.Type, _ json: String) throws -> Value {
    try JSONDecoder().decode(type, from: Data(json.utf8))
  }
}
