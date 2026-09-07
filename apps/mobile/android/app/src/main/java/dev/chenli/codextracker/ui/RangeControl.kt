package dev.chenli.codextracker.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.CustomDayRange
import dev.chenli.codextracker.domain.UsageRange
import dev.chenli.codextracker.ui.theme.TrackerTheme
import dev.chenli.codextracker.ui.theme.TrackerType
import dev.chenli.codextracker.ui.theme.weight
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

fun UsageRange.labelRes(): Int =
  when (this) {
    UsageRange.Today -> R.string.range_today
    UsageRange.SevenDays -> R.string.range_7d
    UsageRange.ThirtyDays -> R.string.range_30d
    UsageRange.NinetyDays -> R.string.range_90d
    UsageRange.OneYear -> R.string.range_365d
    UsageRange.PlanStart -> R.string.range_plan_start
    UsageRange.Custom -> R.string.range_custom
  }

/** The iOS `RangeControl`: a calendar-labelled menu button; "Custom" opens the date sheet. */
@Composable
fun RangeControl(
  range: UsageRange,
  customRange: CustomDayRange,
  today: LocalDate,
  onRangeSelected: (UsageRange) -> Unit,
  onCustomRangeApplied: (LocalDate, LocalDate) -> Unit,
  modifier: Modifier = Modifier,
) {
  val colors = TrackerTheme.colors
  var menuOpen by remember { mutableStateOf(false) }
  var sheetOpen by rememberSaveable { mutableStateOf(false) }
  val rangeLabel = stringResource(R.string.range_label)
  Box(modifier) {
    val shape = RoundedCornerShape(10.dp)
    Row(
      modifier =
        Modifier
          .heightIn(min = 44.dp)
          .clip(shape)
          .background(colors.card)
          .border(1.dp, colors.border, shape)
          .clickable(role = Role.DropdownList) { menuOpen = true }
          .padding(horizontal = 12.dp)
          .semantics { contentDescription = rangeLabel }
          .testTag("range_selector"),
      horizontalArrangement = Arrangement.spacedBy(6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(
        TrackerIcons.calendar,
        contentDescription = null,
        tint = colors.accent,
        modifier = Modifier.size(18.dp),
      )
      Text(
        stringResource(range.labelRes()),
        style = TrackerType.subheadline.weight(FontWeight.SemiBold),
        color = colors.accent,
        maxLines = 1,
      )
    }
    DropdownMenu(
      expanded = menuOpen,
      onDismissRequest = { menuOpen = false },
      containerColor = colors.card,
    ) {
      UsageRange.entries.forEach { option ->
        DropdownMenuItem(
          text = { Text(stringResource(option.labelRes()), style = TrackerType.body, color = colors.text) },
          trailingIcon = {
            if (option == range) {
              Icon(TrackerIcons.check, contentDescription = null, tint = colors.accent)
            }
          },
          onClick = {
            menuOpen = false
            if (option == UsageRange.Custom) sheetOpen = true else onRangeSelected(option)
          },
          modifier = Modifier.testTag("range_${option.key}"),
        )
      }
    }
  }
  if (sheetOpen) {
    CustomRangeSheet(
      initial = customRange,
      today = today,
      onApply = { from, to ->
        onCustomRangeApplied(from, to)
        sheetOpen = false
      },
      onDismiss = { sheetOpen = false },
    )
  }
}

private enum class DateField { From, To }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CustomRangeSheet(
  initial: CustomDayRange,
  today: LocalDate,
  onApply: (LocalDate, LocalDate) -> Unit,
  onDismiss: () -> Unit,
) {
  val colors = TrackerTheme.colors
  val locale = currentAppLocale()
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  var from by remember { mutableStateOf(initial.from) }
  var to by remember { mutableStateOf(initial.to) }
  var picking by remember { mutableStateOf<DateField?>(null) }
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheetState,
    containerColor = colors.background,
    contentColor = colors.text,
    modifier = Modifier.testTag("custom_range_sheet"),
  ) {
    Column(
      modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Text(
        stringResource(R.string.range_custom_title),
        style = TrackerType.headline,
        color = colors.text,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
      )
      DashboardCard {
        DateRow(stringResource(R.string.range_from), from, locale, "range_from") { picking = DateField.From }
        CardDivider()
        DateRow(stringResource(R.string.range_to), to, locale, "range_to") { picking = DateField.To }
        CardDivider()
        TextButton(
          onClick = { onApply(from, to) },
          modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).testTag("range_apply"),
        ) {
          Text(stringResource(R.string.range_apply), style = TrackerType.body, color = colors.accent)
        }
      }
    }
  }
  picking?.let { field ->
    key(field) {
      val current = if (field == DateField.From) from else to
      val latest = today.toUtcMillis()
      val pickerState =
        rememberDatePickerState(
          initialSelectedDateMillis = current.toUtcMillis(),
          selectableDates =
            object : SelectableDates {
              override fun isSelectableDate(utcTimeMillis: Long): Boolean = utcTimeMillis <= latest

              override fun isSelectableYear(year: Int): Boolean = year <= today.year
            },
        )
      DatePickerDialog(
        onDismissRequest = { picking = null },
        confirmButton = {
          TextButton(
            onClick = {
              pickerState.selectedDateMillis?.let { millis ->
                val picked = millis.toLocalDateUtc()
                if (field == DateField.From) from = picked else to = picked
              }
              picking = null
            }
          ) {
            Text(stringResource(R.string.common_ok))
          }
        },
        dismissButton = {
          TextButton(onClick = { picking = null }) { Text(stringResource(R.string.common_cancel)) }
        },
      ) {
        DatePicker(state = pickerState, title = { Text(stringResource(R.string.range_pick_date), modifier = Modifier.padding(start = 24.dp, top = 16.dp)) })
      }
    }
  }
}

@Composable
private fun DateRow(
  label: String,
  date: LocalDate,
  locale: java.util.Locale,
  testTag: String,
  onClick: () -> Unit,
) {
  val colors = TrackerTheme.colors
  Row(
    modifier =
      Modifier
        .fillMaxWidth()
        .heightIn(min = 44.dp)
        .clickable(role = Role.Button, onClick = onClick)
        .testTag(testTag),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(label, style = TrackerType.body, color = colors.text, modifier = Modifier.weight(1f))
    Spacer(Modifier.width(12.dp))
    Text(
      AppFormat.date(date, locale),
      style = TrackerType.body,
      color = colors.accent,
      modifier =
        Modifier
          .background(colors.accent.copy(alpha = 0.12f), RoundedCornerShape(8.dp))
          .padding(horizontal = 10.dp, vertical = 6.dp),
    )
  }
}

private fun LocalDate.toUtcMillis(): Long = atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

private fun Long.toLocalDateUtc(): LocalDate =
  Instant.ofEpochMilli(this).atZone(ZoneOffset.UTC).toLocalDate()
