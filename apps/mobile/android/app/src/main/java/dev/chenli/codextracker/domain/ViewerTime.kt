package dev.chenli.codextracker.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.isActive

interface ViewerClock {
  val ticks: Flow<Long>

  fun nowMillis(): Long

  suspend fun wakeAt(deadlineMillis: Long): Long
}

class SystemViewerClock(
  private val tickMillis: Long = 15_000L,
  private val currentTimeMillis: () -> Long = System::currentTimeMillis,
  private val delayMillis: suspend (Long) -> Unit = { duration -> delay(duration) },
) : ViewerClock {
  init {
    require(tickMillis > 0)
  }

  override val ticks: Flow<Long> =
    flow {
      while (currentCoroutineContext().isActive) {
        val now = nowMillis()
        emit(now)
        delayMillis(tickMillis - (now % tickMillis))
      }
    }

  override fun nowMillis(): Long = currentTimeMillis()

  override suspend fun wakeAt(deadlineMillis: Long): Long {
    while (true) {
      val now = nowMillis()
      val remaining = deadlineMillis - now
      if (remaining <= 0) return now
      delayMillis(remaining)
    }
  }
}

data class QueryRefreshKey(val utcHour: Long, val localDate: LocalDate) {
  companion object {
    private const val HourMillis = 60L * 60L * 1_000L

    fun from(now: Long, zoneId: ZoneId): QueryRefreshKey =
      QueryRefreshKey(
        utcHour = now / HourMillis,
        localDate = Instant.ofEpochMilli(now).atZone(zoneId).toLocalDate(),
      )
  }
}

object LiveFreshness {
  const val TtlMillis = 2L * 60L * 1_000L

  fun isFresh(updatedAt: Long, now: Long): Boolean = now - updatedAt < TtlMillis

  fun liveDevices(devices: List<LiveDevice>, now: Long): List<LiveDevice> =
    devices.filter { isFresh(it.live.updatedAt, now) }

  fun members(members: List<Member>, now: Long): List<Member> =
    members.map { member ->
      member.copy(live = member.live?.takeIf { isFresh(it.updatedAt, now) })
    }

  fun devices(devices: List<Device>, now: Long): List<Device> =
    devices.map { device ->
      device.copy(live = device.live?.takeIf { isFresh(it.updatedAt, now) })
    }
}
