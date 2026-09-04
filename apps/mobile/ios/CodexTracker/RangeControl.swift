import SwiftUI

struct RangeControl: View {
  @ObservedObject var model: AppModel
  @State private var showsCustomRange = false

  var body: some View {
    Menu {
      ForEach(UsageRange.allCases, id: \.self) { range in
        Button {
          if range == .custom {
            showsCustomRange = true
          } else {
            model.range = range
          }
        } label: {
          if model.range == range {
            Label(LocalizedStringKey(range.localizationKey), systemImage: "checkmark")
          } else {
            Text(LocalizedStringKey(range.localizationKey))
          }
        }
        .accessibilityIdentifier("range.\(range.rawValue)")
      }
    } label: {
      Label(LocalizedStringKey(model.range.localizationKey), systemImage: "calendar")
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(Color.appAccent)
        .frame(minHeight: 44)
        .padding(.horizontal, 12)
        .background(Color.appCard, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 10).stroke(Color.appBorder) }
    }
    .accessibilityLabel(Text("range.label"))
    .accessibilityIdentifier("range.selector")
    .sheet(isPresented: $showsCustomRange) {
      CustomRangeSheet(model: model)
        .presentationDetents([.medium])
    }
  }
}
private struct CustomRangeSheet: View {
  @ObservedObject var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State private var from: Date
  @State private var to: Date

  init(model: AppModel) {
    self.model = model
    _from = State(initialValue: model.customFrom)
    _to = State(initialValue: model.customTo)
  }

  var body: some View {
    NavigationStack {
      Form {
        DatePicker("range.from", selection: $from, in: ...Date(), displayedComponents: .date)
        DatePicker("range.to", selection: $to, in: ...Date(), displayedComponents: .date)
        Button("range.apply") {
          let normalized = RangeCalculator.normalizeCustom(
            from: RangeCalculator.dayString(from),
            to: RangeCalculator.dayString(to),
            today: RangeCalculator.dayString(Date())
          )
          model.customFrom = RangeCalculator.date(from: normalized.from) ?? from
          model.customTo = RangeCalculator.date(from: normalized.to) ?? to
          model.range = .custom
          dismiss()
        }
        .frame(maxWidth: .infinity, minHeight: 44)
      }
      .navigationTitle("range.customTitle")
      .navigationBarTitleDisplayMode(.inline)
    }
  }
}
