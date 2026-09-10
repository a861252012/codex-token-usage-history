import Cocoa
import Foundation
import QuartzCore
import Darwin

func acquireHudLock(at path: String) throws -> Int32? {
    let descriptor = open(path, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    if flock(descriptor, LOCK_EX | LOCK_NB) == 0 { return descriptor }
    let error = errno
    close(descriptor)
    if error == EWOULDBLOCK { return nil }
    throw NSError(domain: NSPOSIXErrorDomain, code: Int(error))
}

struct HudLoginItem {
    let homeDirectory: URL
    let executableURL: URL

    private var plistURL: URL {
        homeDirectory.appendingPathComponent("Library/LaunchAgents/com.codex.token-usage-hud.plist")
    }

    var isEnabled: Bool {
        guard let data = try? Data(contentsOf: plistURL),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else {
            return false
        }
        return plist["Label"] as? String == "com.codex.token-usage-hud"
            && plist["RunAtLoad"] as? Bool == true
            && plist["ProgramArguments"] as? [String] == [executableURL.path]
    }

    func setEnabled(_ enabled: Bool) throws {
        if enabled {
            guard FileManager.default.isExecutableFile(atPath: executableURL.path) else {
                throw CocoaError(.fileReadNoSuchFile)
            }
            let plist: [String: Any] = [
                "Label": "com.codex.token-usage-hud",
                "ProgramArguments": [executableURL.path],
                "RunAtLoad": true,
                "LimitLoadToSessionType": "Aqua"
            ]
            let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
            try FileManager.default.createDirectory(at: plistURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: plistURL, options: .atomic)
        } else if FileManager.default.fileExists(atPath: plistURL.path) {
            try FileManager.default.removeItem(at: plistURL)
        }
    }
}

// MARK: - Color Hex Conversion Extension

extension NSColor {
    convenience init?(hex: String) {
        var cleanHex = hex.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if cleanHex.hasPrefix("#") {
            cleanHex.remove(at: cleanHex.startIndex)
        }
        guard cleanHex.count == 6, let rgbValue = UInt32(cleanHex, radix: 16) else {
            return nil
        }
        let redComponent = CGFloat((rgbValue & 0xFF0000) >> 16) / 255.0
        let greenComponent = CGFloat((rgbValue & 0x00FF00) >> 8) / 255.0
        let blueComponent = CGFloat(rgbValue & 0x0000FF) / 255.0
        self.init(red: redComponent, green: greenComponent, blue: blueComponent, alpha: 1.0)
    }

    func toHex() -> String {
        guard let rgbColor = self.usingColorSpace(.sRGB) else {
            return "#0A84FF"
        }
        let redInt = Int(round(rgbColor.redComponent * 255.0))
        let greenInt = Int(round(rgbColor.greenComponent * 255.0))
        let blueInt = Int(round(rgbColor.blueComponent * 255.0))
        return String(format: "#%02X%02X%02X", redInt, greenInt, blueInt)
    }
}

// MARK: - Multi-Language Localization System

enum AppLanguage: String, CaseIterable, Codable {
    case zhHant = "zh-Hant" // 繁體中文
    case en = "en"         // English
    case ja = "ja"         // 日本語
    case zhHans = "zh-Hans" // 简体中文

    var displayName: String {
        switch self {
        case .zhHant: return "繁體中文 (Traditional Chinese)"
        case .en: return "English"
        case .ja: return "日本語 (Japanese)"
        case .zhHans: return "简体中文 (Simplified Chinese)"
        }
    }
}

struct HudLocalization {
    static func string(key: String, language: AppLanguage) -> String {
        switch language {
        case .zhHant:
            switch key {
            case "header_title": return "Codex 用量懸浮球"
            case "weekly_quota": return "週配額剩餘"
            case "five_hour_quota": return "5小時配額剩餘"
            case "quota_unavailable": return "無資料"
            case "source": return "資料來源"
            case "updated_at": return "資料更新"
            case "error_reason": return "狀態說明"
            case "source_wham": return "官方 API"
            case "source_wham_stale": return "官方 API（非即時）"
            case "source_cache": return "本機快取（非即時）"
            case "source_fallback": return "離線備援（非即時）"
            case "source_unknown": return "未知來源"
            case "unknown": return "未知"
            case "reset_credits": return "可用重置券"
            case "plan_event": return "方案異動"
            case "today_usage": return "今日累積"
            case "requests": return "紀錄筆數"
            case "widget_size": return "視窗尺寸 (Widget Size)"
            case "language": return "介面語言 (Language)"
            case "open_dashboard": return "開啟 Web 儀表板"
            case "quit": return "退出 Codex 懸浮球"
            case "launch_at_login": return "登入時自動啟動"
            case "login_error": return "無法變更自動啟動設定"
            case "ready": return "已就緒"
            case "calls": return "筆"
            default: return key
            }
        case .en:
            switch key {
            case "header_title": return "Codex Usage Orb"
            case "weekly_quota": return "Weekly Quota"
            case "five_hour_quota": return "5-Hour Quota"
            case "quota_unavailable": return "Unavailable"
            case "source": return "Source"
            case "updated_at": return "Updated"
            case "error_reason": return "Status"
            case "source_wham": return "Official API"
            case "source_wham_stale": return "Official API (not live)"
            case "source_cache": return "Local cache (not live)"
            case "source_fallback": return "Offline fallback (not live)"
            case "source_unknown": return "Unknown source"
            case "unknown": return "Unknown"
            case "reset_credits": return "Reset Credits"
            case "plan_event": return "Plan Event"
            case "today_usage": return "Today"
            case "requests": return "Records"
            case "widget_size": return "Widget Size"
            case "language": return "Language / 語言"
            case "open_dashboard": return "Open Dashboard (Web)"
            case "quit": return "Quit Codex Orb"
            case "launch_at_login": return "Launch at Login"
            case "login_error": return "Could not change login settings"
            case "ready": return "Ready"
            case "calls": return "records"
            default: return key
            }
        case .ja:
            switch key {
            case "header_title": return "Codex 使用量オーブ"
            case "weekly_quota": return "週間クォータ残り"
            case "five_hour_quota": return "5時間クォータ残り"
            case "quota_unavailable": return "データなし"
            case "source": return "データソース"
            case "updated_at": return "更新日時"
            case "error_reason": return "状態"
            case "source_wham": return "公式 API"
            case "source_wham_stale": return "公式 API（リアルタイムではありません）"
            case "source_cache": return "ローカルキャッシュ（リアルタイムではありません）"
            case "source_fallback": return "オフライン代替（リアルタイムではありません）"
            case "source_unknown": return "不明なソース"
            case "unknown": return "不明"
            case "reset_credits": return "利用可能なリセットチケット"
            case "plan_event": return "プラン変更履歴"
            case "today_usage": return "本日累計"
            case "requests": return "記録件数"
            case "widget_size": return "ウィジェットサイズ (Widget Size)"
            case "language": return "表示言語 (Language)"
            case "open_dashboard": return "Web ダッシュボードを開く"
            case "quit": return "Codex オーブを終了"
            case "launch_at_login": return "ログイン時に自動起動"
            case "login_error": return "自動起動設定を変更できませんでした"
            case "ready": return "準備完了"
            case "calls": return "件"
            default: return key
            }
        case .zhHans:
            switch key {
            case "header_title": return "Codex 用量悬浮球"
            case "weekly_quota": return "周配额剩余"
            case "five_hour_quota": return "5小时配额剩余"
            case "quota_unavailable": return "无数据"
            case "source": return "数据来源"
            case "updated_at": return "数据更新"
            case "error_reason": return "状态说明"
            case "source_wham": return "官方 API"
            case "source_wham_stale": return "官方 API（非实时）"
            case "source_cache": return "本地缓存（非实时）"
            case "source_fallback": return "离线备用（非实时）"
            case "source_unknown": return "未知来源"
            case "unknown": return "未知"
            case "reset_credits": return "可用重置券"
            case "plan_event": return "方案变动"
            case "today_usage": return "今日累计"
            case "requests": return "记录条数"
            case "widget_size": return "窗口尺寸 (Widget Size)"
            case "language": return "界面语言 (Language)"
            case "open_dashboard": return "打开 Web 仪表板"
            case "quit": return "退出 Codex 悬浮球"
            case "launch_at_login": return "登录时自动启动"
            case "login_error": return "无法更改自动启动设置"
            case "ready": return "就绪"
            case "calls": return "条"
            default: return key
            }
        }
    }
}

// MARK: - Widget Size Preset Configuration

struct WidgetSizePreset {
    let key: String
    let nameZhHant: String
    let nameEn: String
    let nameJa: String
    let nameZhHans: String
    let dimension: CGFloat
    let cornerRadius: CGFloat
    let ringRadius: CGFloat
    let ringLineWidth: CGFloat
    let tagFontSize: CGFloat
    let tagY: CGFloat
    let tagHeight: CGFloat
    let valueFontSize: CGFloat
    let valueY: CGFloat
    let valueHeight: CGFloat
    let closeButtonSize: CGFloat
    let closeButtonOffset: CGFloat
    let closeButtonFontSize: CGFloat

    func getLocalizedName(for language: AppLanguage) -> String {
        switch language {
        case .zhHant: return nameZhHant
        case .en: return nameEn
        case .ja: return nameJa
        case .zhHans: return nameZhHans
        }
    }
}

let availableSizePresets: [WidgetSizePreset] = [
    WidgetSizePreset(
        key: "small",
        nameZhHant: "小尺寸 (Small - 46px)",
        nameEn: "Small (46px)",
        nameJa: "スモール (Small - 46px)",
        nameZhHans: "小尺寸 (Small - 46px)",
        dimension: 46.0,
        cornerRadius: 23.0,
        ringRadius: 18.5,
        ringLineWidth: 2.8,
        tagFontSize: 7.0,
        tagY: 26.0,
        tagHeight: 10.0,
        valueFontSize: 11.0,
        valueY: 9.0,
        valueHeight: 15.0,
        closeButtonSize: 12.0,
        closeButtonOffset: 3.0,
        closeButtonFontSize: 7.5
    ),
    WidgetSizePreset(
        key: "default",
        nameZhHant: "標準 (Default - 56px)",
        nameEn: "Default (56px)",
        nameJa: "標準 (Default - 56px)",
        nameZhHans: "标准 (Default - 56px)",
        dimension: 56.0,
        cornerRadius: 28.0,
        ringRadius: 23.5,
        ringLineWidth: 3.2,
        tagFontSize: 8.5,
        tagY: 31.0,
        tagHeight: 12.0,
        valueFontSize: 13.5,
        valueY: 12.0,
        valueHeight: 18.0,
        closeButtonSize: 14.5,
        closeButtonOffset: 4.0,
        closeButtonFontSize: 8.5
    ),
    WidgetSizePreset(
        key: "large",
        nameZhHant: "大尺寸 (Large - 68px)",
        nameEn: "Large (68px)",
        nameJa: "ラージ (Large - 68px)",
        nameZhHans: "大尺寸 (Large - 68px)",
        dimension: 68.0,
        cornerRadius: 34.0,
        ringRadius: 29.0,
        ringLineWidth: 3.8,
        tagFontSize: 10.0,
        tagY: 38.0,
        tagHeight: 14.0,
        valueFontSize: 16.5,
        valueY: 14.0,
        valueHeight: 22.0,
        closeButtonSize: 16.5,
        closeButtonOffset: 5.0,
        closeButtonFontSize: 10.0
    ),
    WidgetSizePreset(
        key: "extraLarge",
        nameZhHant: "特大尺寸 (Extra Large - 84px)",
        nameEn: "Extra Large (84px)",
        nameJa: "特大 (Extra Large - 84px)",
        nameZhHans: "特大尺寸 (Extra Large - 84px)",
        dimension: 84.0,
        cornerRadius: 42.0,
        ringRadius: 36.0,
        ringLineWidth: 4.8,
        tagFontSize: 12.0,
        tagY: 48.0,
        tagHeight: 16.0,
        valueFontSize: 20.0,
        valueY: 17.0,
        valueHeight: 26.0,
        closeButtonSize: 19.0,
        closeButtonOffset: 6.0,
        closeButtonFontSize: 11.5
    )
]

struct HudUserConfiguration: Codable {
    var widgetSizePresetKey: String?
    var languageKey: String?
}

// MARK: - Data Transfer Objects (DTO)

struct WindowQuotaDTO: Codable {
    let usedPercent: Double
    let remainingPercent: Double
    let resetCountdown: String
    let resetAfterSeconds: Int?
}

struct QuotaSnapshotDTO: Codable {
    let updatedAt: Int64?
    let email: String?
    let planType: String?
    let fiveHour: WindowQuotaDTO?
    let weekly: WindowQuotaDTO?
    let resetCredits: Int?
    let resetCreditsKnown: Bool?
    let source: String?
    let errorReason: String?
}

struct PlanChangeEventDTO: Codable {
    let timestamp: Int64
    let datetime: String
    let previousPlan: String?
    let newPlan: String?
    let changeType: String?
    let description: String?
}

struct FullStatusDTO: Codable {
    let snapshot: QuotaSnapshotDTO
    let todaySummary: TodaySummaryDTO
    let recentRecords: [TokenRecordDTO]
    let recentPlanChanges: [PlanChangeEventDTO]?
}

struct TodaySummaryDTO: Codable {
    let requests: Int
    let totalTokens: Int
    let inputTokens: Int
    let outputTokens: Int
    let hourlyBurnRate: Int
    let formattedCostUsd: String?
}

struct TokenRecordDTO: Codable {
    let timestamp: Int64
    let datetime: String
    let model: String
    let totalTokens: Int
    let weeklyUsedPct: Double?
}

// MARK: - Close Badge Button Component (Bottom-Left Quick Dismiss)

class CloseBadgeButton: NSView {
    var closeActionHandler: (() -> Void)?

    private let symbolLabel = NSTextField()
    private var trackingAreaInstance: NSTrackingArea?
    private var buttonHoverActive: Bool = false

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        configureComponent()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configureComponent()
    }

    private func configureComponent() {
        self.wantsLayer = true
        layer?.masksToBounds = true
        updateCornerRadius()

        layer?.backgroundColor = NSColor(hex: "#E5E5EA")?.cgColor ?? NSColor.lightGray.cgColor
        layer?.borderColor = NSColor(hex: "#8E8E93")?.withAlphaComponent(0.35).cgColor
        layer?.borderWidth = 0.5

        symbolLabel.isEditable = false
        symbolLabel.isSelectable = false
        symbolLabel.isBezeled = false
        symbolLabel.drawsBackground = false
        symbolLabel.alignment = .center
        symbolLabel.textColor = NSColor.black
        symbolLabel.font = NSFont.systemFont(ofSize: 8.5, weight: .bold)
        symbolLabel.stringValue = "\u{2715}"
        symbolLabel.frame = NSRect(x: 0, y: -0.5, width: bounds.width, height: bounds.height)

        addSubview(symbolLabel)
        self.alphaValue = 0.0
    }

    func updateCornerRadius() {
        layer?.cornerRadius = min(bounds.width, bounds.height) / 2.0
    }

    func updateLayoutSize(dimension: CGFloat, fontSize: CGFloat) {
        self.frame.size = CGSize(width: dimension, height: dimension)
        updateCornerRadius()
        symbolLabel.frame = NSRect(x: 0, y: -0.5, width: dimension, height: dimension)
        symbolLabel.font = NSFont.systemFont(ofSize: fontSize, weight: .bold)
    }

    func setContainerHovered(_ hovered: Bool) {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            if buttonHoverActive {
                self.alphaValue = 1.0
            } else {
                self.alphaValue = hovered ? 0.95 : 0.0
            }
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existingArea = trackingAreaInstance {
            removeTrackingArea(existingArea)
        }
        let trackingOptions: NSTrackingArea.Options = [
            .mouseEnteredAndExited,
            .activeAlways,
            .inVisibleRect
        ]
        let newArea = NSTrackingArea(rect: bounds, options: trackingOptions, owner: self, userInfo: nil)
        addTrackingArea(newArea)
        trackingAreaInstance = newArea
    }

    override func mouseEntered(with event: NSEvent) {
        buttonHoverActive = true
        self.alphaValue = 1.0
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.15
            layer?.backgroundColor = NSColor(hex: "#FF453A")?.cgColor ?? NSColor.systemRed.cgColor
            layer?.borderColor = NSColor.systemRed.cgColor
            symbolLabel.textColor = NSColor.white
        }
    }

    override func mouseExited(with event: NSEvent) {
        buttonHoverActive = false
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            layer?.backgroundColor = NSColor(hex: "#E5E5EA")?.cgColor ?? NSColor.lightGray.cgColor
            layer?.borderColor = NSColor(hex: "#8E8E93")?.withAlphaComponent(0.35).cgColor
            symbolLabel.textColor = NSColor.black
        }
    }

    override func mouseDown(with event: NSEvent) {
        // 攔截滑鼠按下事件，避免觸發父層視窗拖曳
    }

    override func mouseUp(with event: NSEvent) {
        if buttonHoverActive {
            closeActionHandler?()
        }
    }
}

// MARK: - Circular Ring View Component

class CircularOrbView: NSView {
    var leftClickHandler: (() -> Void)?
    var contextMenuProvider: (() -> NSMenu)?
    var hoverChangeHandler: ((Bool) -> Void)?

    private let backgroundTrackLayer = CAShapeLayer()
    private let dynamicProgressLayer = CAShapeLayer()
    private var trackingAreaInstance: NSTrackingArea?

    private var currentDimension: CGFloat = 56.0
    private var currentRingRadius: CGFloat = 23.5
    private var currentRingLineWidth: CGFloat = 3.2

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        configureVisualStyling()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configureVisualStyling()
    }

    private func configureVisualStyling() {
        self.wantsLayer = true

        currentDimension = min(frame.width, frame.height)
        let radius = currentDimension / 2

        layer?.cornerRadius = radius
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor(hex: "#141518")?.cgColor ?? NSColor.black.cgColor
        layer?.borderColor = NSColor.white.withAlphaComponent(0.14).cgColor
        layer?.borderWidth = 1.0

        setupProgressLayers()
    }

    private func setupProgressLayers() {
        let centerPoint = CGPoint(x: currentDimension / 2, y: currentDimension / 2)
        let startAngle: CGFloat = -CGFloat.pi / 2
        let endAngle: CGFloat = 1.5 * CGFloat.pi

        let ringPath = CGMutablePath()
        ringPath.addArc(
            center: centerPoint,
            radius: currentRingRadius,
            startAngle: startAngle,
            endAngle: endAngle,
            clockwise: false
        )

        // 1. Background Track Layer
        backgroundTrackLayer.path = ringPath
        backgroundTrackLayer.strokeColor = NSColor.white.withAlphaComponent(0.12).cgColor
        backgroundTrackLayer.fillColor = NSColor.clear.cgColor
        backgroundTrackLayer.lineWidth = currentRingLineWidth
        backgroundTrackLayer.lineCap = .round
        layer?.addSublayer(backgroundTrackLayer)

        // 2. Dynamic Progress Layer
        dynamicProgressLayer.path = ringPath
        dynamicProgressLayer.strokeColor = NSColor.systemGreen.cgColor
        dynamicProgressLayer.fillColor = NSColor.clear.cgColor
        dynamicProgressLayer.lineWidth = currentRingLineWidth
        dynamicProgressLayer.lineCap = .round
        dynamicProgressLayer.strokeStart = 0.0
        dynamicProgressLayer.strokeEnd = 0.0
        layer?.addSublayer(dynamicProgressLayer)
    }

    func applySizePreset(_ preset: WidgetSizePreset) {
        currentDimension = preset.dimension
        currentRingRadius = preset.ringRadius
        currentRingLineWidth = preset.ringLineWidth

        layer?.cornerRadius = preset.cornerRadius

        let centerPoint = CGPoint(x: currentDimension / 2, y: currentDimension / 2)
        let startAngle: CGFloat = -CGFloat.pi / 2
        let endAngle: CGFloat = 1.5 * CGFloat.pi

        let ringPath = CGMutablePath()
        ringPath.addArc(
            center: centerPoint,
            radius: currentRingRadius,
            startAngle: startAngle,
            endAngle: endAngle,
            clockwise: false
        )

        backgroundTrackLayer.path = ringPath
        backgroundTrackLayer.lineWidth = currentRingLineWidth

        dynamicProgressLayer.path = ringPath
        dynamicProgressLayer.lineWidth = currentRingLineWidth
    }

    func updateRingProgress(percentage: Double, tintColor: NSColor) {
        let clampedPercentage = max(0.0, min(100.0, percentage))
        let targetStrokeEnd = CGFloat(clampedPercentage / 100.0)

        CATransaction.begin()
        CATransaction.setAnimationDuration(0.45)
        CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .easeInEaseOut))
        dynamicProgressLayer.strokeEnd = targetStrokeEnd
        dynamicProgressLayer.strokeColor = tintColor.cgColor
        CATransaction.commit()
    }

    func triggerPulseAnimation() {
        let bounceAnimation = CAKeyframeAnimation(keyPath: "transform.scale")
        bounceAnimation.values = [1.0, 1.10, 0.96, 1.04, 1.0]
        bounceAnimation.keyTimes = [0.0, 0.25, 0.5, 0.75, 1.0]
        bounceAnimation.duration = 0.42
        bounceAnimation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer?.add(bounceAnimation, forKey: "orbFeedingBounce")
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existingArea = trackingAreaInstance {
            removeTrackingArea(existingArea)
        }
        let trackingOptions: NSTrackingArea.Options = [
            .mouseEnteredAndExited,
            .activeAlways,
            .inVisibleRect
        ]
        let newArea = NSTrackingArea(rect: bounds, options: trackingOptions, owner: self, userInfo: nil)
        addTrackingArea(newArea)
        trackingAreaInstance = newArea
    }

    override func mouseEntered(with event: NSEvent) {
        layer?.borderColor = NSColor.white.withAlphaComponent(0.35).cgColor
        layer?.borderWidth = 1.2
        hoverChangeHandler?(true)
    }

    override func mouseExited(with event: NSEvent) {
        layer?.borderColor = NSColor.white.withAlphaComponent(0.14).cgColor
        layer?.borderWidth = 1.0
        hoverChangeHandler?(false)
    }

    override func mouseUp(with event: NSEvent) {
        if event.clickCount == 1 {
            leftClickHandler?()
        } else {
            super.mouseUp(with: event)
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        if let contextMenu = contextMenuProvider?() {
            NSMenu.popUpContextMenu(contextMenu, with: event, for: self)
        } else {
            super.rightMouseDown(with: event)
        }
    }
}

// MARK: - Modern Always-on-Top Floating Panel

class ModernFloatingHudPanel: NSPanel {
    init(contentRect: NSRect) {
        super.init(
            contentRect: contentRect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        self.isOpaque = false
        self.backgroundColor = .clear
        self.hasShadow = true
        self.level = .floating
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        self.isMovableByWindowBackground = true
    }
}

// MARK: - Application Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
    private var floatingPanel: ModernFloatingHudPanel!
    private var rootHudCanvasView: NSView!
    private var orbContainerView: CircularOrbView!
    private var closeBadgeButton: CloseBadgeButton!
    private let badgeOverlapMargin: CGFloat = 8.0

    // Text Subviews inside Circular Orb
    private var secondaryTagLabel: NSTextField!
    private var primaryValueLabel: NSTextField!

    private var refreshTimer: Timer?
    private var refreshIntervalSeconds: TimeInterval = 5
    private let homeDirectoryPath = FileManager.default.homeDirectoryForCurrentUser.path
    private var previousTotalTokens: Int = 0
    private var feedingCountdownRounds: Int = 0
    private var latestIncrementTokens: Int = 0

    // Theme Color State & Preferences

    // Size Preset State & Preferences
    private var activeSizePresetKey: String = "default"

    // Language State & Preferences
    private var currentLanguage: AppLanguage = .zhHant

    // Display state
    // 0: Quota view
    // 1: Today cost view
    private var displayModeIndex: Int = 0

    private var cachedStatusData: FullStatusDTO?

    func applicationDidFinishLaunching(_ notification: Notification) {
        loadUserConfiguration()
        setupFloatingWindow()
        loadLatestData()
        startPeriodicTimer()
    }

    private func getConfigurationFilePath() -> String {
        return "\(homeDirectoryPath)/.codex/hud_config.json"
    }

    private func loadUserConfiguration() {
        let configurationFilePath = getConfigurationFilePath()
        guard let configurationData = try? Data(contentsOf: URL(fileURLWithPath: configurationFilePath)),
              let userConfig = try? JSONDecoder().decode(HudUserConfiguration.self, from: configurationData) else {
            return
        }

        if let savedSize = userConfig.widgetSizePresetKey,
           availableSizePresets.contains(where: { $0.key == savedSize }) {
            activeSizePresetKey = savedSize
        }
        if let savedLang = userConfig.languageKey,
           let lang = AppLanguage(rawValue: savedLang) {
            currentLanguage = lang
        }
    }

    private func saveUserConfiguration() {
        let configurationFilePath = getConfigurationFilePath()
        let configRecord = HudUserConfiguration(
            widgetSizePresetKey: activeSizePresetKey,
            languageKey: currentLanguage.rawValue
        )

        guard let encodedData = try? JSONEncoder().encode(configRecord) else {
            return
        }
        try? encodedData.write(to: URL(fileURLWithPath: configurationFilePath))
    }

    private func getCurrentSizePreset() -> WidgetSizePreset {
        return availableSizePresets.first(where: { $0.key == activeSizePresetKey })
            ?? availableSizePresets[1] // default 56px
    }

    private func setupFloatingWindow() {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let sizePreset = getCurrentSizePreset()
        let orbDimension = sizePreset.dimension
        let totalWidth = orbDimension + badgeOverlapMargin
        let totalHeight = orbDimension + badgeOverlapMargin
        let initialX = screenFrame.origin.x + (screenFrame.width - totalWidth) / 2
        let initialY = screenFrame.origin.y + screenFrame.height - totalHeight - 14

        let panelRect = NSRect(x: initialX, y: initialY, width: totalWidth, height: totalHeight)
        floatingPanel = ModernFloatingHudPanel(contentRect: panelRect)

        rootHudCanvasView = NSView(frame: NSRect(x: 0, y: 0, width: totalWidth, height: totalHeight))
        rootHudCanvasView.wantsLayer = true
        rootHudCanvasView.layer?.backgroundColor = NSColor.clear.cgColor

        orbContainerView = CircularOrbView(frame: NSRect(x: badgeOverlapMargin, y: badgeOverlapMargin, width: orbDimension, height: orbDimension))
        orbContainerView.applySizePreset(sizePreset)

        // Left-click to switch views, Right-click to show contextual menu
        orbContainerView.leftClickHandler = { [weak self] in
            self?.cycleNextDisplayMode()
        }
        orbContainerView.contextMenuProvider = { [weak self] in
            return self?.buildContextMenu() ?? NSMenu()
        }
        orbContainerView.hoverChangeHandler = { [weak self] hovered in
            self?.closeBadgeButton?.setContainerHovered(hovered)
        }

        buildTextLabels(sizePreset: sizePreset)
        rootHudCanvasView.addSubview(orbContainerView)

        setupCloseButton(sizePreset: sizePreset)
        rootHudCanvasView.addSubview(closeBadgeButton)

        floatingPanel.contentView = rootHudCanvasView
        floatingPanel.makeKeyAndOrderFront(nil)
    }

    private func setupCloseButton(sizePreset: WidgetSizePreset) {
        let buttonSize = sizePreset.closeButtonSize
        let buttonX: CGFloat = 1.0
        let buttonY: CGFloat = 1.0
        let closeRect = NSRect(x: buttonX, y: buttonY, width: buttonSize, height: buttonSize)

        closeBadgeButton = CloseBadgeButton(frame: closeRect)
        closeBadgeButton.updateLayoutSize(dimension: buttonSize, fontSize: sizePreset.closeButtonFontSize)
        closeBadgeButton.closeActionHandler = {
            NSApplication.shared.terminate(nil)
        }
    }

    private func buildTextLabels(sizePreset: WidgetSizePreset) {
        let orbDimension = sizePreset.dimension

        // Upper tiny category tag
        secondaryTagLabel = NSTextField(frame: NSRect(x: 2, y: sizePreset.tagY, width: orbDimension - 4, height: sizePreset.tagHeight))
        secondaryTagLabel.isEditable = false
        secondaryTagLabel.isSelectable = false
        secondaryTagLabel.isBezeled = false
        secondaryTagLabel.drawsBackground = false
        secondaryTagLabel.alignment = .center
        secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.65)
        secondaryTagLabel.font = NSFont.systemFont(ofSize: sizePreset.tagFontSize, weight: .bold)
        secondaryTagLabel.stringValue = "7d"
        orbContainerView.addSubview(secondaryTagLabel)

        // Center prominent metric text
        primaryValueLabel = NSTextField(frame: NSRect(x: 2, y: sizePreset.valueY, width: orbDimension - 4, height: sizePreset.valueHeight))
        primaryValueLabel.isEditable = false
        primaryValueLabel.isSelectable = false
        primaryValueLabel.isBezeled = false
        primaryValueLabel.drawsBackground = false
        primaryValueLabel.alignment = .center
        primaryValueLabel.textColor = NSColor.white
        primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.valueFontSize, weight: .bold)
        primaryValueLabel.stringValue = "--"
        orbContainerView.addSubview(primaryValueLabel)
    }

    private func applyWidgetSizePreset(_ preset: WidgetSizePreset) {
        activeSizePresetKey = preset.key
        saveUserConfiguration()

        let currentFrame = floatingPanel.frame
        let currentCenterX = currentFrame.origin.x + currentFrame.width / 2
        let currentCenterY = currentFrame.origin.y + currentFrame.height / 2

        let totalWidth = preset.dimension + badgeOverlapMargin
        let totalHeight = preset.dimension + badgeOverlapMargin
        let newOriginX = currentCenterX - totalWidth / 2
        let newOriginY = currentCenterY - totalHeight / 2

        let newFrame = NSRect(x: newOriginX, y: newOriginY, width: totalWidth, height: totalHeight)
        floatingPanel.setFrame(newFrame, display: true, animate: true)

        rootHudCanvasView.frame = NSRect(x: 0, y: 0, width: totalWidth, height: totalHeight)
        orbContainerView.frame = NSRect(x: badgeOverlapMargin, y: badgeOverlapMargin, width: preset.dimension, height: preset.dimension)
        orbContainerView.applySizePreset(preset)

        secondaryTagLabel.frame = NSRect(x: 2, y: preset.tagY, width: preset.dimension - 4, height: preset.tagHeight)
        primaryValueLabel.frame = NSRect(x: 2, y: preset.valueY, width: preset.dimension - 4, height: preset.valueHeight)

        let buttonSize = preset.closeButtonSize
        let buttonX: CGFloat = 1.0
        let buttonY: CGFloat = 1.0
        closeBadgeButton.frame = NSRect(x: buttonX, y: buttonY, width: buttonSize, height: buttonSize)
        closeBadgeButton.updateLayoutSize(dimension: buttonSize, fontSize: preset.closeButtonFontSize)

        if let status = cachedStatusData {
            updateUserInterface(with: status)
        }
    }

    private func cycleNextDisplayMode() {
        displayModeIndex = (displayModeIndex + 1) % 2
        if let statusData = cachedStatusData {
            updateUserInterface(with: statusData)
        }
    }

    private func hasValidUpdatedAt(_ timestampMilliseconds: Int64?) -> Bool {
        guard let timestampMilliseconds = timestampMilliseconds, timestampMilliseconds > 0 else { return false }
        return timestampMilliseconds <= Int64(Date().timeIntervalSince1970 * 1000)
    }

    private func isLiveSnapshot(_ snapshot: QuotaSnapshotDTO) -> Bool {
        guard snapshot.source == "wham",
              (snapshot.errorReason ?? "").isEmpty,
              hasValidUpdatedAt(snapshot.updatedAt),
              let updatedAt = snapshot.updatedAt else {
            return false
        }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return now - updatedAt <= 120_000
    }

    private func sourceDescription(_ snapshot: QuotaSnapshotDTO) -> String {
        switch snapshot.source {
        case "wham":
            let key = isLiveSnapshot(snapshot) ? "source_wham" : "source_wham_stale"
            return HudLocalization.string(key: key, language: currentLanguage)
        case "cache": return HudLocalization.string(key: "source_cache", language: currentLanguage)
        case "fallback": return HudLocalization.string(key: "source_fallback", language: currentLanguage)
        default: return HudLocalization.string(key: "source_unknown", language: currentLanguage)
        }
    }

    private func formatUpdatedAt(_ timestampMilliseconds: Int64?) -> String {
        guard hasValidUpdatedAt(timestampMilliseconds), let timestampMilliseconds = timestampMilliseconds else {
            return HudLocalization.string(key: "unknown", language: currentLanguage)
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(timestampMilliseconds) / 1000.0))
    }

    private func asLocalCache(_ snapshot: QuotaSnapshotDTO) -> QuotaSnapshotDTO {
        return QuotaSnapshotDTO(
            updatedAt: snapshot.updatedAt,
            email: snapshot.email,
            planType: snapshot.planType,
            fiveHour: snapshot.fiveHour,
            weekly: snapshot.weekly,
            resetCredits: snapshot.resetCredits,
            resetCreditsKnown: snapshot.resetCreditsKnown,
            source: "cache",
            errorReason: snapshot.errorReason?.isEmpty == false
                ? snapshot.errorReason
                : "即時服務無法使用，顯示最後快照"
        )
    }

    private func buildContextMenu() -> NSMenu {
        let menu = NSMenu(title: "Codex Orb")

        // Widget Size Submenu
        let sizeSubmenuTitle = HudLocalization.string(key: "widget_size", language: currentLanguage)
        let sizeSubmenu = NSMenu(title: sizeSubmenuTitle)
        for preset in availableSizePresets {
            let sizeItem = NSMenuItem(
                title: preset.getLocalizedName(for: currentLanguage),
                action: #selector(handleSizePresetSelected(_:)),
                keyEquivalent: ""
            )
            sizeItem.target = self
            sizeItem.representedObject = preset.key
            sizeItem.state = (activeSizePresetKey == preset.key) ? .on : .off
            sizeSubmenu.addItem(sizeItem)
        }

        let sizeMenuItem = NSMenuItem(title: sizeSubmenuTitle, action: nil, keyEquivalent: "")
        sizeMenuItem.submenu = sizeSubmenu
        menu.addItem(sizeMenuItem)

        // 3. Language Submenu (多語系支援)
        let langSubmenuTitle = HudLocalization.string(key: "language", language: currentLanguage)
        let langSubmenu = NSMenu(title: langSubmenuTitle)
        for lang in AppLanguage.allCases {
            let langItem = NSMenuItem(
                title: lang.displayName,
                action: #selector(handleLanguageSelected(_:)),
                keyEquivalent: ""
            )
            langItem.target = self
            langItem.representedObject = lang.rawValue
            langItem.state = (currentLanguage == lang) ? .on : .off
            langSubmenu.addItem(langItem)
        }

        let langMenuItem = NSMenuItem(title: langSubmenuTitle, action: nil, keyEquivalent: "")
        langMenuItem.submenu = langSubmenu
        menu.addItem(langMenuItem)

        menu.addItem(NSMenuItem.separator())

        let webItem = NSMenuItem(
            title: HudLocalization.string(key: "open_dashboard", language: currentLanguage),
            action: #selector(openWebDashboard),
            keyEquivalent: "d"
        )
        webItem.target = self
        menu.addItem(webItem)

        let loginItem = NSMenuItem(
            title: HudLocalization.string(key: "launch_at_login", language: currentLanguage),
            action: #selector(toggleLaunchAtLogin),
            keyEquivalent: ""
        )
        loginItem.target = self
        loginItem.state = hudLoginItem?.isEnabled == true ? .on : .off
        loginItem.isEnabled = hudLoginItem != nil
        menu.addItem(loginItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(
            title: HudLocalization.string(key: "quit", language: currentLanguage),
            action: #selector(terminateApplication),
            keyEquivalent: "q"
        )
        quitItem.target = self
        menu.addItem(quitItem)

        return menu
    }

    private var hudLoginItem: HudLoginItem? {
        guard let executableURL = Bundle.main.executableURL else { return nil }
        return HudLoginItem(homeDirectory: FileManager.default.homeDirectoryForCurrentUser,
                            executableURL: executableURL.resolvingSymlinksInPath())
    }

    @objc private func toggleLaunchAtLogin() {
        guard let loginItem = hudLoginItem else { return }
        do {
            try loginItem.setEnabled(!loginItem.isEnabled)
        } catch {
            let alert = NSAlert()
            alert.messageText = HudLocalization.string(key: "login_error", language: currentLanguage)
            alert.informativeText = error.localizedDescription
            alert.alertStyle = .warning
            alert.runModal()
        }
    }

    @objc private func handleLanguageSelected(_ sender: NSMenuItem) {
        guard let langRaw = sender.representedObject as? String,
              let selectedLang = AppLanguage(rawValue: langRaw) else {
            return
        }

        currentLanguage = selectedLang
        saveUserConfiguration()
    }

    @objc private func handleSizePresetSelected(_ sender: NSMenuItem) {
        guard let selectedSizeKey = sender.representedObject as? String,
              let matchedPreset = availableSizePresets.first(where: { $0.key == selectedSizeKey }) else {
            return
        }

        applyWidgetSizePreset(matchedPreset)
    }

    @objc private func openWebDashboard() {
        let dashboardUrlString = "http://127.0.0.1:10200"
        guard let url = URL(string: dashboardUrlString) else { return }

        let checkTask = Process()
        checkTask.launchPath = "/usr/bin/nc"
        checkTask.arguments = ["-z", "127.0.0.1", "10200"]
        let pipe = Pipe()
        checkTask.standardOutput = pipe
        checkTask.standardError = pipe

        var serverRunning: Bool = false
        do {
            try checkTask.run()
            checkTask.waitUntilExit()
            serverRunning = (checkTask.terminationStatus == 0)
        } catch {
            serverRunning = false
        }

        if !serverRunning {
            let launchTask = Process()
            launchTask.launchPath = "/bin/bash"
            launchTask.arguments = ["-c", "codex-usage dashboard &"]
            try? launchTask.run()
        } else {
            NSWorkspace.shared.open(url)
        }
    }

    private func startPeriodicTimer() {
        let directory = ProcessInfo.processInfo.environment["CODEX_HOME"] ?? "\(homeDirectoryPath)/.codex"
        var interval: TimeInterval = 5
        if let data = try? Data(contentsOf: URL(fileURLWithPath: directory).appendingPathComponent("hud-settings.json")),
           let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let value = settings["refreshIntervalSeconds"] as? NSNumber,
           CFGetTypeID(value) != CFBooleanGetTypeID(),
           value.doubleValue.isFinite,
           value.doubleValue.rounded() == value.doubleValue,
           (1...300).contains(value.doubleValue) {
            interval = value.doubleValue
        }
        refreshIntervalSeconds = interval
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: refreshIntervalSeconds, repeats: false) { [weak self] _ in
            self?.loadLatestData()
            self?.startPeriodicTimer()
        }
    }

    private func loadLatestData() {
        DispatchQueue.global(qos: .userInteractive).async { [weak self] in
            guard let self = self else { return }

            var fetchedStatus: FullStatusDTO?

            let urlString = "http://127.0.0.1:10200/api/status"
            if let serverUrl = URL(string: urlString) {
                var request = URLRequest(url: serverUrl)
                request.timeoutInterval = 0.8
                let semaphore = DispatchSemaphore(value: 0)

                let task = URLSession.shared.dataTask(with: request) { data, _, _ in
                    if let rawData = data, let decodedStatus = try? JSONDecoder().decode(FullStatusDTO.self, from: rawData) {
                        fetchedStatus = decodedStatus
                    }
                    semaphore.signal()
                }
                task.resume()
                _ = semaphore.wait(timeout: .now() + 0.8)
            }

            if fetchedStatus == nil {
                let cacheFilePath = "\(self.homeDirectoryPath)/.codex/codex_quota_snapshot.json"
                if let rawData = try? Data(contentsOf: URL(fileURLWithPath: cacheFilePath)),
                   let snapshot = try? JSONDecoder().decode(QuotaSnapshotDTO.self, from: rawData) {
                    let sqliteTodaySummary = self.queryTodaySummaryFromDatabase()
                    let latestPlanChange = self.queryRecentPlanChangeFromDatabase()
                    let planChangeList = latestPlanChange != nil ? [latestPlanChange!] : []

                    fetchedStatus = FullStatusDTO(
                        snapshot: self.asLocalCache(snapshot),
                        todaySummary: sqliteTodaySummary,
                        recentRecords: [],
                        recentPlanChanges: planChangeList
                    )
                }
            }

            guard let statusData = fetchedStatus else {
                if let previousStatus = self.cachedStatusData {
                    let staleStatus = FullStatusDTO(
                        snapshot: self.asLocalCache(previousStatus.snapshot),
                        todaySummary: previousStatus.todaySummary,
                        recentRecords: previousStatus.recentRecords,
                        recentPlanChanges: previousStatus.recentPlanChanges
                    )
                    self.cachedStatusData = staleStatus
                    DispatchQueue.main.async {
                        self.updateUserInterface(with: staleStatus)
                    }
                }
                return
            }
            self.cachedStatusData = statusData

            DispatchQueue.main.async {
                self.updateUserInterface(with: statusData)
            }
        }
    }

    private func queryRecentPlanChangeFromDatabase() -> PlanChangeEventDTO? {
        let databasePath = "\(homeDirectoryPath)/.codex/token_usage_history.sqlite"
        guard FileManager.default.fileExists(atPath: databasePath) else { return nil }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
        process.arguments = [
            databasePath,
            "SELECT timestamp, datetime, previous_plan, new_plan, change_type, description FROM plan_change_events ORDER BY timestamp DESC LIMIT 1;"
        ]

        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        try? process.run()
        process.waitUntilExit()

        let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
        if let outputString = String(data: outputData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !outputString.isEmpty {
            let components = outputString.components(separatedBy: "|")
            if components.count >= 6 {
                return PlanChangeEventDTO(
                    timestamp: Int64(components[0]) ?? 0,
                    datetime: components[1],
                    previousPlan: components[2],
                    newPlan: components[3],
                    changeType: components[4],
                    description: components[5]
                )
            }
        }
        return nil
    }

    private func queryTodaySummaryFromDatabase() -> TodaySummaryDTO {
        let databasePath = "\(homeDirectoryPath)/.codex/token_usage_history.sqlite"
        guard FileManager.default.fileExists(atPath: databasePath) else {
            return TodaySummaryDTO(requests: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, hourlyBurnRate: 0, formattedCostUsd: "$0.00")
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
        let startOfDayTimestamp = Int64(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000)
        process.arguments = [
            databasePath,
            "SELECT COUNT(*), COALESCE(SUM(total_tokens), 0), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(cost_usd), 0.0) FROM token_records WHERE timestamp >= \(startOfDayTimestamp);"
        ]

        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        try? process.run()
        process.waitUntilExit()

        let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
        if let outputString = String(data: outputData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
            let components = outputString.components(separatedBy: "|")
            if components.count >= 5 {
                let totalRequests = Int(components[0]) ?? 0
                let totalTokens = Int(components[1]) ?? 0
                let inputTokens = Int(components[2]) ?? 0
                let outputTokens = Int(components[3]) ?? 0
                let costDouble = Double(components[4]) ?? 0.0
                return TodaySummaryDTO(
                    requests: totalRequests,
                    totalTokens: totalTokens,
                    inputTokens: inputTokens,
                    outputTokens: outputTokens,
                    hourlyBurnRate: 0,
                    formattedCostUsd: String(format: "$%.2f", costDouble)
                )
            }
        }

        return TodaySummaryDTO(requests: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, hourlyBurnRate: 0, formattedCostUsd: "$0.00")
    }

    private func updateUserInterface(with statusData: FullStatusDTO) {
        let snapshot = statusData.snapshot
        let summary = statusData.todaySummary
        let sizePreset = getCurrentSizePreset()

        let weeklyRemaining = snapshot.weekly.map { Int($0.remainingPercent) }
        let fiveHourRemaining = snapshot.fiveHour.map { Int($0.remainingPercent) }
        let availablePercentages = [snapshot.fiveHour?.remainingPercent, snapshot.weekly?.remainingPercent].compactMap { $0 }
        let targetPercentage = availablePercentages.min() ?? 0
        let hasQuotaData = !availablePercentages.isEmpty

        // Ring Tint Color Calculation
        var ringTint: NSColor

        if !hasQuotaData {
            ringTint = NSColor.systemGray
        } else {
            // 動態健康色階: 滿綠 -> 黃 -> 橘 -> 吃緊紅
            if targetPercentage >= 60.0 {
                ringTint = NSColor(hex: "#30D158") ?? NSColor.systemGreen
            } else if targetPercentage >= 35.0 {
                ringTint = NSColor(hex: "#FFD60A") ?? NSColor.systemYellow
            } else if targetPercentage >= 20.0 {
                ringTint = NSColor(hex: "#FF9F0A") ?? NSColor.systemOrange
            } else {
                ringTint = NSColor(hex: "#FF453A") ?? NSColor.systemRed
            }
        }

        orbContainerView.updateRingProgress(percentage: targetPercentage, tintColor: ringTint)

        primaryValueLabel.textColor = NSColor.white

        if displayModeIndex == 1 {
            // View 1: Today estimated cost
            secondaryTagLabel.stringValue = "COST"
            secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.65)
            secondaryTagLabel.font = NSFont.systemFont(ofSize: sizePreset.tagFontSize - 1.0, weight: .bold)
            primaryValueLabel.stringValue = summary.formattedCostUsd ?? "$0.00"
            primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.valueFontSize - 2.0, weight: .bold)
        } else {
            // View 0: Primary quota view
            let isLive = isLiveSnapshot(snapshot)
            secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.75)
            secondaryTagLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.tagFontSize, weight: .bold)

            if !isLive {
                switch snapshot.source {
                case "cache": secondaryTagLabel.stringValue = "CACHE"
                case "fallback": secondaryTagLabel.stringValue = "OFFLINE"
                case "wham": secondaryTagLabel.stringValue = "STALE"
                default: secondaryTagLabel.stringValue = "UNKNOWN"
                }

                if let fiveHourRemaining = fiveHourRemaining, let weeklyRemaining = weeklyRemaining {
                    primaryValueLabel.stringValue = "5:\(fiveHourRemaining) 7:\(weeklyRemaining)"
                    primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.tagFontSize, weight: .bold)
                } else if let fiveHourRemaining = fiveHourRemaining {
                    primaryValueLabel.stringValue = "5h:\(fiveHourRemaining)%"
                    primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.tagFontSize, weight: .bold)
                } else if let weeklyRemaining = weeklyRemaining {
                    primaryValueLabel.stringValue = "7d:\(weeklyRemaining)%"
                    primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.tagFontSize, weight: .bold)
                } else {
                    primaryValueLabel.stringValue = "--"
                    primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.valueFontSize, weight: .bold)
                }
            } else if let fiveHourRemaining = fiveHourRemaining, let weeklyRemaining = weeklyRemaining {
                secondaryTagLabel.stringValue = "5h:\(fiveHourRemaining)%"
                primaryValueLabel.stringValue = "7d:\(weeklyRemaining)%"
                primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.tagFontSize, weight: .bold)
            } else if let fiveHourRemaining = fiveHourRemaining {
                secondaryTagLabel.stringValue = "5h"
                primaryValueLabel.stringValue = "\(fiveHourRemaining)%"
                primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.valueFontSize, weight: .bold)
            } else if let weeklyRemaining = weeklyRemaining {
                secondaryTagLabel.stringValue = "7d"
                primaryValueLabel.stringValue = "\(weeklyRemaining)%"
                primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.valueFontSize, weight: .bold)
            } else {
                secondaryTagLabel.stringValue = "QUOTA"
                primaryValueLabel.stringValue = "--"
                primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.valueFontSize, weight: .bold)
            }
        }
    }

    private func formatTokenCount(tokens: Int) -> String {
        if tokens >= 1_000_000 {
            let millions = Double(tokens) / 1_000_000.0
            return String(format: "%.1fM", millions)
        } else if tokens >= 1_000 {
            let thousands = Double(tokens) / 1_000.0
            return String(format: "%.1fk", thousands)
        }
        return "\(tokens)"
    }

    @objc private func terminateApplication() {
        NSApplication.shared.terminate(nil)
    }
}

// MARK: - Main Entry Point

// Keep the descriptor open for the process lifetime; the kernel releases it on exit.
let hudLock: Int32
do {
    let path = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex-hud.lock").path
    guard let descriptor = try acquireHudLock(at: path) else { exit(0) }
    hudLock = descriptor
} catch {
    fputs("Unable to acquire HUD instance lock: \(error)\n", stderr)
    exit(1)
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let delegate = AppDelegate()
application.delegate = delegate
application.run()
