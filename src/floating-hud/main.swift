import Cocoa
import Foundation
import QuartzCore

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

// MARK: - Color Preset Configuration

struct ThemeColorPreset {
    let key: String
    let displayName: String
    let hexCode: String
}

let availableThemePresets: [ThemeColorPreset] = [
    ThemeColorPreset(key: "lightBlue", displayName: "Light Blue / 淺藍 (Default)", hexCode: "#38B6FF"),
    ThemeColorPreset(key: "electricBlue", displayName: "Electric Blue (深電光藍)", hexCode: "#0A84FF"),
    ThemeColorPreset(key: "cyberCyan", displayName: "Cyber Cyan (賽博青藍)", hexCode: "#00F2FE"),
    ThemeColorPreset(key: "emeraldGreen", displayName: "Emerald Green (翡翠綠)", hexCode: "#30D158"),
    ThemeColorPreset(key: "neonPurple", displayName: "Neon Purple (賽博紫)", hexCode: "#BF5AF2"),
    ThemeColorPreset(key: "sunsetAmber", displayName: "Sunset Amber (日落橘)", hexCode: "#FF9F0A"),
    ThemeColorPreset(key: "radiantPink", displayName: "Radiant Pink (亮粉紅)", hexCode: "#FF375F"),
    ThemeColorPreset(key: "pureWhite", displayName: "Pure White (極簡白)", hexCode: "#F2F2F7")
]

// MARK: - Widget Size Preset Configuration

struct WidgetSizePreset {
    let key: String
    let displayName: String
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
}

let availableSizePresets: [WidgetSizePreset] = [
    WidgetSizePreset(
        key: "small",
        displayName: "Small (小 - 46px)",
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
        displayName: "Default (預設 - 56px)",
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
        displayName: "Large (大 - 68px)",
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
        displayName: "Extra Large (超大 - 84px)",
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
    var themeColorHex: String
    var themePresetKey: String
    var enableLowQuotaWarning: Bool
    var widgetSizePresetKey: String?
}

// MARK: - Data Transfer Objects (DTO)

struct WindowQuotaDTO: Codable {
    let usedPercent: Double
    let remainingPercent: Double
    let resetCountdown: String
    let resetAfterSeconds: Int?
}

struct QuotaSnapshotDTO: Codable {
    let email: String?
    let planType: String?
    let fiveHour: WindowQuotaDTO?
    let weekly: WindowQuotaDTO?
    let resetCredits: Int?
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

// MARK: - Close Badge Button Component (Top-Right Quick Dismiss)

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

        layer?.backgroundColor = NSColor(hex: "#0C2338")?.withAlphaComponent(0.88).cgColor
            ?? NSColor.black.withAlphaComponent(0.60).cgColor
        layer?.borderColor = NSColor(hex: "#38B6FF")?.withAlphaComponent(0.75).cgColor
            ?? NSColor.systemTeal.cgColor
        layer?.borderWidth = 1.0

        symbolLabel.isEditable = false
        symbolLabel.isSelectable = false
        symbolLabel.isBezeled = false
        symbolLabel.drawsBackground = false
        symbolLabel.alignment = .center
        symbolLabel.textColor = NSColor(hex: "#38B6FF") ?? NSColor.systemTeal
        symbolLabel.font = NSFont.systemFont(ofSize: 8.5, weight: .bold)
        symbolLabel.stringValue = "✕"
        symbolLabel.frame = NSRect(x: 0, y: -0.5, width: bounds.width, height: bounds.height)

        addSubview(symbolLabel)
        self.alphaValue = 0.85
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
                self.alphaValue = hovered ? 1.0 : 0.85
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
            layer?.backgroundColor = NSColor(hex: "#38B6FF")?.withAlphaComponent(0.95).cgColor
            layer?.borderColor = NSColor.white.withAlphaComponent(0.85).cgColor
            symbolLabel.textColor = NSColor.white
        }
    }

    override func mouseExited(with event: NSEvent) {
        buttonHoverActive = false
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            layer?.backgroundColor = NSColor(hex: "#0C2338")?.withAlphaComponent(0.88).cgColor
            layer?.borderColor = NSColor(hex: "#38B6FF")?.withAlphaComponent(0.75).cgColor
            symbolLabel.textColor = NSColor(hex: "#38B6FF") ?? NSColor.systemTeal
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

class CircularOrbView: NSVisualEffectView {
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
        self.material = .hudWindow
        self.blendingMode = .behindWindow
        self.state = .active
        self.wantsLayer = true

        currentDimension = min(frame.width, frame.height)
        let radius = currentDimension / 2

        layer?.cornerRadius = radius
        layer?.masksToBounds = true
        layer?.borderColor = NSColor.white.withAlphaComponent(0.18).cgColor
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
        dynamicProgressLayer.strokeColor = NSColor(hex: "#0A84FF")?.cgColor ?? NSColor.systemBlue.cgColor
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
        layer?.borderColor = NSColor.white.withAlphaComponent(0.42).cgColor
        layer?.borderWidth = 1.4
        hoverChangeHandler?(true)
    }

    override func mouseExited(with event: NSEvent) {
        layer?.borderColor = NSColor.white.withAlphaComponent(0.18).cgColor
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
    private let homeDirectoryPath = FileManager.default.homeDirectoryForCurrentUser.path
    private var previousTotalTokens: Int = 0
    private var feedingCountdownRounds: Int = 0
    private var latestIncrementTokens: Int = 0

    // Theme Color State & Preferences
    private var activeThemeColor: NSColor = NSColor(hex: "#38B6FF") ?? NSColor.systemTeal
    private var activeThemePresetKey: String = "lightBlue"
    private var lowQuotaWarningEnabled: Bool = true

    // Size Preset State & Preferences
    private var activeSizePresetKey: String = "default"

    // Display state
    // 0: Quota view (7d for Pro, 5h+7d for Standard)
    // 1: Today tokens view
    // 2: Today cost view
    private var displayModeIndex: Int = 0
    private var forceProModeOverride: Bool? = nil

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

        var loadedColorHex = userConfig.themeColorHex
        if loadedColorHex.uppercased() == "#0A84FF" || userConfig.themePresetKey == "electricBlue" {
            loadedColorHex = "#38B6FF"
            activeThemePresetKey = "lightBlue"
        } else {
            activeThemePresetKey = userConfig.themePresetKey
        }

        if let loadedColor = NSColor(hex: loadedColorHex) {
            activeThemeColor = loadedColor
        }
        lowQuotaWarningEnabled = userConfig.enableLowQuotaWarning
        if let savedSize = userConfig.widgetSizePresetKey,
           availableSizePresets.contains(where: { $0.key == savedSize }) {
            activeSizePresetKey = savedSize
        }
    }

    private func saveUserConfiguration() {
        let configurationFilePath = getConfigurationFilePath()
        let configRecord = HudUserConfiguration(
            themeColorHex: activeThemeColor.toHex(),
            themePresetKey: activeThemePresetKey,
            enableLowQuotaWarning: lowQuotaWarningEnabled,
            widgetSizePresetKey: activeSizePresetKey
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

        orbContainerView = CircularOrbView(frame: NSRect(x: 0, y: 0, width: orbDimension, height: orbDimension))
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
        let orbDimension = sizePreset.dimension
        let buttonSize = sizePreset.closeButtonSize
        let buttonX = orbDimension - buttonSize + badgeOverlapMargin
        let buttonY = orbDimension - buttonSize + badgeOverlapMargin
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
        primaryValueLabel.stringValue = "--%"
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
        orbContainerView.frame = NSRect(x: 0, y: 0, width: preset.dimension, height: preset.dimension)
        orbContainerView.applySizePreset(preset)

        secondaryTagLabel.frame = NSRect(x: 2, y: preset.tagY, width: preset.dimension - 4, height: preset.tagHeight)
        primaryValueLabel.frame = NSRect(x: 2, y: preset.valueY, width: preset.dimension - 4, height: preset.valueHeight)

        let buttonSize = preset.closeButtonSize
        let buttonX = preset.dimension - buttonSize + badgeOverlapMargin
        let buttonY = preset.dimension - buttonSize + badgeOverlapMargin
        closeBadgeButton.frame = NSRect(x: buttonX, y: buttonY, width: buttonSize, height: buttonSize)
        closeBadgeButton.updateLayoutSize(dimension: buttonSize, fontSize: preset.closeButtonFontSize)

        if let status = cachedStatusData {
            updateUserInterface(with: status)
        }
    }

    private func cycleNextDisplayMode() {
        displayModeIndex = (displayModeIndex + 1) % 3
        if let statusData = cachedStatusData {
            updateUserInterface(with: statusData)
        }
    }

    private func determineProUser(snapshot: QuotaSnapshotDTO) -> Bool {
        if let forced = forceProModeOverride {
            return forced
        }
        let plan = snapshot.planType?.lowercased() ?? ""
        if plan.contains("pro") {
            return true
        }
        if snapshot.fiveHour == nil {
            return true
        }
        return false
    }

    private func buildContextMenu() -> NSMenu {
        let menu = NSMenu(title: "Codex Orb")

        let planName = cachedStatusData?.snapshot.planType ?? "Pro"
        let headerTitle = "Codex Usage Orb (\(planName))"
        let headerItem = NSMenuItem(title: headerTitle, action: nil, keyEquivalent: "")
        headerItem.isEnabled = false
        menu.addItem(headerItem)

        menu.addItem(NSMenuItem.separator())

        if let snapshot = cachedStatusData?.snapshot {
            let weeklyRem = Int(snapshot.weekly?.remainingPercent ?? 100)
            let weeklyCountdown = snapshot.weekly?.resetCountdown ?? "Ready"
            let weeklyItem = NSMenuItem(title: "Weekly Quota: \(weeklyRem)% left (Reset: \(weeklyCountdown))", action: nil, keyEquivalent: "")
            weeklyItem.isEnabled = false
            menu.addItem(weeklyItem)

            if let fiveHour = snapshot.fiveHour {
                let fiveRem = Int(fiveHour.remainingPercent)
                let fiveCountdown = fiveHour.resetCountdown
                let fiveItem = NSMenuItem(title: "5-Hour Quota: \(fiveRem)% left (Reset: \(fiveCountdown))", action: nil, keyEquivalent: "")
                fiveItem.isEnabled = false
                menu.addItem(fiveItem)
            } else {
                let unlimItem = NSMenuItem(title: "5-Hour Quota: Unlimited (Pro Tier)", action: nil, keyEquivalent: "")
                unlimItem.isEnabled = false
                menu.addItem(unlimItem)
            }

            if let credits = snapshot.resetCredits, credits > 0 {
                let creditsItem = NSMenuItem(title: "Reset Credits: \(credits) available", action: nil, keyEquivalent: "")
                creditsItem.isEnabled = false
                menu.addItem(creditsItem)
            }
        }

        // Plan Transition History item (if exists)
        if let planChanges = cachedStatusData?.recentPlanChanges, let latestChange = planChanges.first {
            let changeTypeUpper = (latestChange.changeType ?? "change").uppercased()
            let planHistoryText = "Plan Event: [\(changeTypeUpper)] \(latestChange.description ?? "")"
            let planItem = NSMenuItem(title: planHistoryText, action: nil, keyEquivalent: "")
            planItem.isEnabled = false
            menu.addItem(planItem)
        }

        menu.addItem(NSMenuItem.separator())

        if let summary = cachedStatusData?.todaySummary {
            let totalFormatted = formatTokenCount(tokens: summary.totalTokens)
            let costText = summary.formattedCostUsd ?? "$0.00"
            let summaryItem = NSMenuItem(title: "Today: \(totalFormatted) tokens (\(costText) USD)", action: nil, keyEquivalent: "")
            summaryItem.isEnabled = false
            menu.addItem(summaryItem)

            let requestsItem = NSMenuItem(title: "Requests: \(summary.requests) calls", action: nil, keyEquivalent: "")
            requestsItem.isEnabled = false
            menu.addItem(requestsItem)
        }

        menu.addItem(NSMenuItem.separator())

        // 1. Accent Color Submenu
        let colorSubmenu = NSMenu(title: "Accent Color")
        for preset in availableThemePresets {
            let presetItem = NSMenuItem(
                title: preset.displayName,
                action: #selector(handlePresetColorSelected(_:)),
                keyEquivalent: ""
            )
            presetItem.target = self
            presetItem.representedObject = preset.key
            presetItem.state = (activeThemePresetKey == preset.key) ? .on : .off
            colorSubmenu.addItem(presetItem)
        }

        colorSubmenu.addItem(NSMenuItem.separator())

        let customPickerItem = NSMenuItem(
            title: "Pick Custom Color...",
            action: #selector(openSystemColorPicker),
            keyEquivalent: ""
        )
        customPickerItem.target = self
        customPickerItem.state = (activeThemePresetKey == "custom") ? .on : .off
        colorSubmenu.addItem(customPickerItem)

        colorSubmenu.addItem(NSMenuItem.separator())

        let warningToggleItem = NSMenuItem(
            title: "Alert Red When Low (<20%)",
            action: #selector(toggleLowQuotaWarning),
            keyEquivalent: ""
        )
        warningToggleItem.target = self
        warningToggleItem.state = lowQuotaWarningEnabled ? .on : .off
        colorSubmenu.addItem(warningToggleItem)

        let colorMenuItem = NSMenuItem(title: "Accent Color", action: nil, keyEquivalent: "")
        colorMenuItem.submenu = colorSubmenu
        menu.addItem(colorMenuItem)

        // 2. Widget Size Submenu (Small, Default, Large, Extra Large)
        let sizeSubmenu = NSMenu(title: "Widget Size")
        for preset in availableSizePresets {
            let sizeItem = NSMenuItem(
                title: preset.displayName,
                action: #selector(handleSizePresetSelected(_:)),
                keyEquivalent: ""
            )
            sizeItem.target = self
            sizeItem.representedObject = preset.key
            sizeItem.state = (activeSizePresetKey == preset.key) ? .on : .off
            sizeSubmenu.addItem(sizeItem)
        }

        let sizeMenuItem = NSMenuItem(title: "Widget Size", action: nil, keyEquivalent: "")
        sizeMenuItem.submenu = sizeSubmenu
        menu.addItem(sizeMenuItem)

        menu.addItem(NSMenuItem.separator())

        let webItem = NSMenuItem(title: "Open Dashboard (Web)", action: #selector(openWebDashboard), keyEquivalent: "d")
        webItem.target = self
        menu.addItem(webItem)

        let refreshItem = NSMenuItem(title: "Force Refresh", action: #selector(forceRefreshData), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)

        menu.addItem(NSMenuItem.separator())

        let proActive = cachedStatusData?.snapshot != nil ? determineProUser(snapshot: cachedStatusData!.snapshot) : true
        let toggleModeTitle = proActive ? "Switch to Standard View (5h + Weekly)" : "Switch to Pro View (Weekly Only)"
        let toggleModeItem = NSMenuItem(title: toggleModeTitle, action: #selector(toggleProModeOverride), keyEquivalent: "")
        toggleModeItem.target = self
        menu.addItem(toggleModeItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Quit Codex Orb", action: #selector(terminateApplication), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        return menu
    }

    @objc private func handlePresetColorSelected(_ sender: NSMenuItem) {
        guard let selectedPresetKey = sender.representedObject as? String,
              let matchedPreset = availableThemePresets.first(where: { $0.key == selectedPresetKey }),
              let resolvedColor = NSColor(hex: matchedPreset.hexCode) else {
            return
        }

        activeThemeColor = resolvedColor
        activeThemePresetKey = matchedPreset.key
        saveUserConfiguration()

        if let status = cachedStatusData {
            updateUserInterface(with: status)
        }
    }

    @objc private func handleSizePresetSelected(_ sender: NSMenuItem) {
        guard let selectedSizeKey = sender.representedObject as? String,
              let matchedPreset = availableSizePresets.first(where: { $0.key == selectedSizeKey }) else {
            return
        }

        applyWidgetSizePreset(matchedPreset)
    }

    @objc private func openSystemColorPicker() {
        let colorPanel = NSColorPanel.shared
        colorPanel.color = activeThemeColor
        colorPanel.setTarget(self)
        colorPanel.setAction(#selector(handleCustomColorFromPanel(_:)))
        colorPanel.orderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func handleCustomColorFromPanel(_ sender: NSColorPanel) {
        activeThemeColor = sender.color
        activeThemePresetKey = "custom"
        saveUserConfiguration()

        if let status = cachedStatusData {
            updateUserInterface(with: status)
        }
    }

    @objc private func toggleLowQuotaWarning() {
        lowQuotaWarningEnabled = !lowQuotaWarningEnabled
        saveUserConfiguration()

        if let status = cachedStatusData {
            updateUserInterface(with: status)
        }
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

    @objc private func forceRefreshData() {
        loadLatestData(forceRefresh: true)
    }

    @objc private func toggleProModeOverride() {
        if let current = forceProModeOverride {
            forceProModeOverride = !current
        } else {
            let proActive = cachedStatusData?.snapshot != nil ? determineProUser(snapshot: cachedStatusData!.snapshot) : true
            forceProModeOverride = !proActive
        }
        if let status = cachedStatusData {
            updateUserInterface(with: status)
        }
    }

    private func startPeriodicTimer() {
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            self?.loadLatestData(forceRefresh: false)
        }
    }

    private func loadLatestData(forceRefresh: Bool = false) {
        DispatchQueue.global(qos: .userInteractive).async { [weak self] in
            guard let self = self else { return }

            var fetchedStatus: FullStatusDTO?

            let urlString = "http://127.0.0.1:10200/api/status" + (forceRefresh ? "?force=true" : "")
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
                        snapshot: snapshot,
                        todaySummary: sqliteTodaySummary,
                        recentRecords: [],
                        recentPlanChanges: planChangeList
                    )
                }
            }

            guard let statusData = fetchedStatus else { return }
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
        let proActive = determineProUser(snapshot: snapshot)
        let sizePreset = getCurrentSizePreset()

        // Token feeding detection
        if previousTotalTokens > 0 && summary.totalTokens > previousTotalTokens {
            latestIncrementTokens = summary.totalTokens - previousTotalTokens
            feedingCountdownRounds = 3
            orbContainerView.triggerPulseAnimation()
        } else if feedingCountdownRounds > 0 {
            feedingCountdownRounds -= 1
        }
        previousTotalTokens = summary.totalTokens

        let weeklyRemaining = Int(snapshot.weekly?.remainingPercent ?? 100)
        let fiveHourRemaining = Int(snapshot.fiveHour?.remainingPercent ?? 100)

        let targetPercentage: Double = proActive ? Double(weeklyRemaining) : Double(min(weeklyRemaining, fiveHourRemaining))

        // Ring Tint Color Calculation based on user-chosen accent color and health rules
        var ringTint: NSColor = activeThemeColor

        if feedingCountdownRounds > 0 {
            // Bright highlight pulse during feeding
            ringTint = NSColor(hex: "#00F2FE") ?? NSColor.systemTeal
        } else if lowQuotaWarningEnabled && targetPercentage < 20.0 {
            // Alert red when critically low
            ringTint = NSColor.systemRed
        } else if lowQuotaWarningEnabled && targetPercentage < 40.0 && activeThemePresetKey == "electricBlue" {
            // Subtle amber warning if using default blue
            ringTint = NSColor.systemYellow
        }

        orbContainerView.updateRingProgress(percentage: targetPercentage, tintColor: ringTint)

        // Text display according to state
        if feedingCountdownRounds > 0 {
            secondaryTagLabel.stringValue = "FEED"
            secondaryTagLabel.textColor = ringTint
            secondaryTagLabel.font = NSFont.systemFont(ofSize: sizePreset.tagFontSize, weight: .bold)
            primaryValueLabel.stringValue = "+\(formatTokenCount(tokens: latestIncrementTokens))"
            primaryValueLabel.textColor = ringTint
            primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.valueFontSize - 1.5, weight: .bold)
            return
        }

        primaryValueLabel.textColor = NSColor.white

        if displayModeIndex == 1 {
            // View 1: Today total tokens
            secondaryTagLabel.stringValue = "TODAY"
            secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.65)
            secondaryTagLabel.font = NSFont.systemFont(ofSize: sizePreset.tagFontSize - 1.0, weight: .bold)
            primaryValueLabel.stringValue = formatTokenCount(tokens: summary.totalTokens)
            primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.valueFontSize - 1.0, weight: .bold)
        } else if displayModeIndex == 2 {
            // View 2: Today estimated cost
            secondaryTagLabel.stringValue = "COST"
            secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.65)
            secondaryTagLabel.font = NSFont.systemFont(ofSize: sizePreset.tagFontSize - 1.0, weight: .bold)
            primaryValueLabel.stringValue = summary.formattedCostUsd ?? "$0.00"
            primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.valueFontSize - 2.0, weight: .bold)
        } else {
            // View 0: Primary quota view
            if proActive {
                // Pro tier: Focus strictly on 7-day weekly quota (clean, elegant, zero 5h noise)
                secondaryTagLabel.stringValue = "7d"
                secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.65)
                secondaryTagLabel.font = NSFont.systemFont(ofSize: sizePreset.tagFontSize, weight: .bold)
                primaryValueLabel.stringValue = "\(weeklyRemaining)%"
                primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.valueFontSize, weight: .bold)
            } else {
                // Standard tier: Present both 5-hour and 7-day limits compactly
                secondaryTagLabel.stringValue = "5h:\(fiveHourRemaining)%"
                secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.8)
                secondaryTagLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.tagFontSize, weight: .bold)
                primaryValueLabel.stringValue = "7d:\(weeklyRemaining)%"
                primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: sizePreset.tagFontSize, weight: .bold)
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

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let delegate = AppDelegate()
application.delegate = delegate
application.run()



