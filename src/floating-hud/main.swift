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
    ThemeColorPreset(key: "electricBlue", displayName: "Electric Blue (Default)", hexCode: "#0A84FF"),
    ThemeColorPreset(key: "cyberCyan", displayName: "Cyber Cyan", hexCode: "#00F2FE"),
    ThemeColorPreset(key: "emeraldGreen", displayName: "Emerald Green", hexCode: "#30D158"),
    ThemeColorPreset(key: "neonPurple", displayName: "Neon Purple", hexCode: "#BF5AF2"),
    ThemeColorPreset(key: "sunsetAmber", displayName: "Sunset Amber", hexCode: "#FF9F0A"),
    ThemeColorPreset(key: "radiantPink", displayName: "Radiant Pink", hexCode: "#FF375F"),
    ThemeColorPreset(key: "pureWhite", displayName: "Pure White", hexCode: "#F2F2F7")
]

struct HudUserConfiguration: Codable {
    var themeColorHex: String
    var themePresetKey: String
    var enableLowQuotaWarning: Bool
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

struct FullStatusDTO: Codable {
    let snapshot: QuotaSnapshotDTO
    let todaySummary: TodaySummaryDTO
    let recentRecords: [TokenRecordDTO]
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

// MARK: - Circular Ring View Component

class CircularOrbView: NSVisualEffectView {
    var leftClickHandler: (() -> Void)?
    var contextMenuProvider: (() -> NSMenu)?

    private let backgroundTrackLayer = CAShapeLayer()
    private let dynamicProgressLayer = CAShapeLayer()
    private var trackingAreaInstance: NSTrackingArea?

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

        let dimension = min(frame.width, frame.height)
        let radius = dimension / 2

        layer?.cornerRadius = radius
        layer?.masksToBounds = true
        layer?.borderColor = NSColor.white.withAlphaComponent(0.18).cgColor
        layer?.borderWidth = 1.0

        setupProgressLayers(dimension: dimension)
    }

    private func setupProgressLayers(dimension: CGFloat) {
        let centerPoint = CGPoint(x: dimension / 2, y: dimension / 2)
        let arcRadius: CGFloat = (dimension / 2) - 4.5
        let startAngle: CGFloat = -CGFloat.pi / 2
        let endAngle: CGFloat = 1.5 * CGFloat.pi

        let ringPath = CGMutablePath()
        ringPath.addArc(
            center: centerPoint,
            radius: arcRadius,
            startAngle: startAngle,
            endAngle: endAngle,
            clockwise: false
        )

        // 1. Background Track Layer
        backgroundTrackLayer.path = ringPath
        backgroundTrackLayer.strokeColor = NSColor.white.withAlphaComponent(0.12).cgColor
        backgroundTrackLayer.fillColor = NSColor.clear.cgColor
        backgroundTrackLayer.lineWidth = 3.2
        backgroundTrackLayer.lineCap = .round
        layer?.addSublayer(backgroundTrackLayer)

        // 2. Dynamic Progress Layer
        dynamicProgressLayer.path = ringPath
        dynamicProgressLayer.strokeColor = NSColor(hex: "#0A84FF")?.cgColor ?? NSColor.systemBlue.cgColor
        dynamicProgressLayer.fillColor = NSColor.clear.cgColor
        dynamicProgressLayer.lineWidth = 3.2
        dynamicProgressLayer.lineCap = .round
        dynamicProgressLayer.strokeStart = 0.0
        dynamicProgressLayer.strokeEnd = 0.0
        layer?.addSublayer(dynamicProgressLayer)
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
    }

    override func mouseExited(with event: NSEvent) {
        layer?.borderColor = NSColor.white.withAlphaComponent(0.18).cgColor
        layer?.borderWidth = 1.0
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
    private var orbContainerView: CircularOrbView!

    // Text Subviews inside Circular Orb
    private var secondaryTagLabel: NSTextField!
    private var primaryValueLabel: NSTextField!

    private var refreshTimer: Timer?
    private let homeDirectoryPath = FileManager.default.homeDirectoryForCurrentUser.path
    private var previousTotalTokens: Int = 0
    private var feedingCountdownRounds: Int = 0
    private var latestIncrementTokens: Int = 0

    // Theme Color State & Preferences
    private var activeThemeColor: NSColor = NSColor(hex: "#0A84FF") ?? NSColor.systemBlue
    private var activeThemePresetKey: String = "electricBlue"
    private var lowQuotaWarningEnabled: Bool = true

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

        if let loadedColor = NSColor(hex: userConfig.themeColorHex) {
            activeThemeColor = loadedColor
        }
        activeThemePresetKey = userConfig.themePresetKey
        lowQuotaWarningEnabled = userConfig.enableLowQuotaWarning
    }

    private func saveUserConfiguration() {
        let configurationFilePath = getConfigurationFilePath()
        let configRecord = HudUserConfiguration(
            themeColorHex: activeThemeColor.toHex(),
            themePresetKey: activeThemePresetKey,
            enableLowQuotaWarning: lowQuotaWarningEnabled
        )

        guard let encodedData = try? JSONEncoder().encode(configRecord) else {
            return
        }
        try? encodedData.write(to: URL(fileURLWithPath: configurationFilePath))
    }

    private func setupFloatingWindow() {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let orbDimension: CGFloat = 56.0
        let initialX = screenFrame.origin.x + (screenFrame.width - orbDimension) / 2
        let initialY = screenFrame.origin.y + screenFrame.height - orbDimension - 14

        let panelRect = NSRect(x: initialX, y: initialY, width: orbDimension, height: orbDimension)
        floatingPanel = ModernFloatingHudPanel(contentRect: panelRect)

        orbContainerView = CircularOrbView(frame: NSRect(x: 0, y: 0, width: orbDimension, height: orbDimension))

        // Left-click to switch views, Right-click to show contextual menu
        orbContainerView.leftClickHandler = { [weak self] in
            self?.cycleNextDisplayMode()
        }
        orbContainerView.contextMenuProvider = { [weak self] in
            return self?.buildContextMenu() ?? NSMenu()
        }

        buildTextLabels(orbDimension: orbDimension)

        floatingPanel.contentView = orbContainerView
        floatingPanel.makeKeyAndOrderFront(nil)
    }

    private func buildTextLabels(orbDimension: CGFloat) {
        // Upper tiny category tag
        secondaryTagLabel = NSTextField(frame: NSRect(x: 4, y: 31, width: orbDimension - 8, height: 12))
        secondaryTagLabel.isEditable = false
        secondaryTagLabel.isSelectable = false
        secondaryTagLabel.isBezeled = false
        secondaryTagLabel.drawsBackground = false
        secondaryTagLabel.alignment = .center
        secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.65)
        secondaryTagLabel.font = NSFont.systemFont(ofSize: 8.5, weight: .bold)
        secondaryTagLabel.stringValue = "7d"
        orbContainerView.addSubview(secondaryTagLabel)

        // Center prominent metric text
        primaryValueLabel = NSTextField(frame: NSRect(x: 4, y: 12, width: orbDimension - 8, height: 18))
        primaryValueLabel.isEditable = false
        primaryValueLabel.isSelectable = false
        primaryValueLabel.isBezeled = false
        primaryValueLabel.drawsBackground = false
        primaryValueLabel.alignment = .center
        primaryValueLabel.textColor = NSColor.white
        primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 13.0, weight: .bold)
        primaryValueLabel.stringValue = "--%"
        orbContainerView.addSubview(primaryValueLabel)
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

        // Accent Color Submenu
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

        menu.addItem(NSMenuItem.separator())

        let webItem = NSMenuItem(title: "Open Web Dashboard", action: #selector(openWebDashboard), keyEquivalent: "d")
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
        if let url = URL(string: "http://127.0.0.1:10200") {
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
                    fetchedStatus = FullStatusDTO(
                        snapshot: snapshot,
                        todaySummary: sqliteTodaySummary,
                        recentRecords: []
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
            primaryValueLabel.stringValue = "+\(formatTokenCount(tokens: latestIncrementTokens))"
            primaryValueLabel.textColor = ringTint
            primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 11.5, weight: .bold)
            return
        }

        primaryValueLabel.textColor = NSColor.white

        if displayModeIndex == 1 {
            // View 1: Today total tokens
            secondaryTagLabel.stringValue = "TODAY"
            secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.65)
            secondaryTagLabel.font = NSFont.systemFont(ofSize: 7.5, weight: .bold)
            primaryValueLabel.stringValue = formatTokenCount(tokens: summary.totalTokens)
            primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 12.0, weight: .bold)
        } else if displayModeIndex == 2 {
            // View 2: Today estimated cost
            secondaryTagLabel.stringValue = "COST"
            secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.65)
            secondaryTagLabel.font = NSFont.systemFont(ofSize: 7.5, weight: .bold)
            primaryValueLabel.stringValue = summary.formattedCostUsd ?? "$0.00"
            primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 11.0, weight: .bold)
        } else {
            // View 0: Primary quota view
            if proActive {
                // Pro tier: Focus strictly on 7-day weekly quota (clean, elegant, zero 5h noise)
                secondaryTagLabel.stringValue = "7d"
                secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.65)
                secondaryTagLabel.font = NSFont.systemFont(ofSize: 8.5, weight: .bold)
                primaryValueLabel.stringValue = "\(weeklyRemaining)%"
                primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 13.5, weight: .bold)
            } else {
                // Standard tier: Present both 5-hour and 7-day limits compactly
                secondaryTagLabel.stringValue = "5h:\(fiveHourRemaining)%"
                secondaryTagLabel.textColor = NSColor.white.withAlphaComponent(0.8)
                secondaryTagLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 8.5, weight: .bold)
                primaryValueLabel.stringValue = "7d:\(weeklyRemaining)%"
                primaryValueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 8.5, weight: .bold)
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


