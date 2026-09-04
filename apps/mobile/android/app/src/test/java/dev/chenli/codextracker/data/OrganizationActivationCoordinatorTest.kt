package dev.chenli.codextracker.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Test

class OrganizationActivationCoordinatorTest {
  @Test
  fun `cancelled old switch cannot finish after or publish over the latest switch`() =
    runTest {
      val coordinator = OrganizationActivationCoordinator()
      val aStarted = CompletableDeferred<Unit>()
      val releaseA = CompletableDeferred<Unit>()
      var activeClerkOrgId: String? = null
      val published = mutableListOf<String>()

      val switchA =
        async(start = CoroutineStart.UNDISPATCHED) {
          coordinator.activate("clerk-a") {
            activeClerkOrgId = "clerk-a"
            aStarted.complete(Unit)
            releaseA.await()
            checkpoint(activeClerkOrgId)
            published += "clerk-a"
            "clerk-a"
          }
        }
      aStarted.await()

      val switchB =
        async(start = CoroutineStart.UNDISPATCHED) {
          coordinator.activate("clerk-b") {
            activeClerkOrgId = "clerk-b"
            checkpoint(activeClerkOrgId)
            published += "clerk-b"
            "clerk-b"
          }
        }
      assertFalse(switchB.isCompleted)

      switchA.cancel()
      releaseA.complete(Unit)

      try {
        switchA.await()
        fail("The stale switch must be cancelled")
      } catch (_: CancellationException) {
        // Expected: B superseded A while A's non-cancellable side effect was in flight.
      }
      assertEquals("clerk-b", switchB.await())
      assertEquals("clerk-b", activeClerkOrgId)
      assertEquals(listOf("clerk-b"), published)
    }

  @Test
  fun `authority mismatch fails closed before publication`() =
    runTest {
      val coordinator = OrganizationActivationCoordinator()
      var published = false

      try {
        coordinator.activate("clerk-b") {
          checkpoint("clerk-a")
          published = true
        }
        fail("Mismatched Clerk authority must stop publication")
      } catch (_: IllegalStateException) {
        // Expected.
      }
      assertFalse(published)
    }
}
