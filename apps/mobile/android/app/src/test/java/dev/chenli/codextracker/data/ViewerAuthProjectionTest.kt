package dev.chenli.codextracker.data

import dev.convex.android.AuthState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ViewerAuthProjectionTest {
  @Test
  fun `cached Clerk principal waits for Convex authentication instead of flashing signed out`() =
    runTest {
      val states =
        flowOf(
            AuthObservation(
              state = AuthState.Unauthenticated(),
              principalId = "user:session",
              clerkInitialized = true,
            )
          )
          .projectViewerAuth()
          .toList()

      assertEquals(listOf(ViewerAuthState.Loading, ViewerAuthState.Loading), states)
    }

  @Test
  fun `signed out Clerk initialization emits signed out without user or session change`() =
    runTest {
      val convex = MutableStateFlow<AuthState<String>>(AuthState.Unauthenticated())
      val initialized = MutableStateFlow(false)
      val states = mutableListOf<ViewerAuthState>()
      val collectJob =
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
          combine(convex, initialized) { state, ready ->
              AuthObservation(state = state, principalId = null, clerkInitialized = ready)
            }
            .projectViewerAuth()
            .take(3)
            .toList(states)
        }

      advanceUntilIdle()
      initialized.value = true
      advanceUntilIdle()

      assertEquals(
        listOf(ViewerAuthState.Loading, ViewerAuthState.Loading, ViewerAuthState.SignedOut),
        states,
      )
      collectJob.join()
    }
}
