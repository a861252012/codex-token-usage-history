import Cocoa
import Foundation

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

// MARK: - Interactive Effect View with Context Menu

class InteractiveEffectView: NSVisualEffectView {
    var leftClickHandler: (() -> Void)?
    var contextMenuProvider: (() -> NSMenu)?

    override func mouseUp(with event: NSEvent) {
        if event.clickCount == 1 {
            leftClickHandler?()
        } else {
            super.mouseUp(with: event)
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        if let menu = contextMenuProvider?() {
            NSMenu.popUpContextMenu(menu, with: event, for: self)
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
    private var containerView: InteractiveEffectView!

    // UI Elements
    private var vitalityIndicatorDot: NSView!
    private var primaryMetricLabel: NSTextField!

    private var refreshTimer: Timer?
    private let homeDirectoryPath = FileManager.default.homeDirectoryForCurrentUser.path
    private var previousTotalTokens: Int = 0
    private var feedingAnimationCountdown: Int = 0
    private var latestIncrementTokens: Int = 0

    // User preferences & toggle state
    private var displayModeIndex: Int = 0 // 0: Quota, 1: Today Usage
    private var forceProMode: Bool? = nil // nil = auto detect, true = Pro, false = Standard

    private var cachedStatusData: FullStatusDTO?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupFloatingWindow()
        loadLatestData()
        startPeriodicTimer()
    }

    private func setupFloatingWindow() {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let initialWidth: CGFloat = 142
        let panelHeight: CGFloat = 28
        let initialX = screenFrame.origin.x + (screenFrame.width - initialWidth) / 2
        let initialY = screenFrame.origin.y + screenFrame.height - panelHeight - 12

        let panelRect = NSRect(x: initialX, y: initialY, width: initialWidth, height: panelHeight)
        floatingPanel = ModernFloatingHudPanel(contentRect: panelRect)

        // Glassmorphism Container
        containerView = InteractiveEffectView(frame: NSRect(x: 0, y: 0, width: initialWidth, height: panelHeight))
        containerView.material = .hudWindow
        containerView.blendingMode = .behindWindow
        containerView.state = .active
        containerView.wantsLayer = true
        containerView.layer?.cornerRadius = panelHeight / 2
        containerView.layer?.masksToBounds = true
        containerView.layer?.borderColor = NSColor.white.withAlphaComponent(0.16).cgColor
        containerView.layer?.borderWidth = 0.8

        // Interactions
        containerView.leftClickHandler = { [weak self] in
            self?.toggleDisplayView()
        }
        containerView.contextMenuProvider = { [weak self] in
            return self?.buildContextMenu() ?? NSMenu()
        }

        buildSubviews(panelHeight: panelHeight)

        floatingPanel.contentView = containerView
        floatingPanel.makeKeyAndOrderFront(nil)
    }

    private func buildSubviews(panelHeight: CGFloat) {
        // 1. Vitality Dot (Breathing LED indicator)
        vitalityIndicatorDot = NSView(frame: NSRect(x: 10, y: (panelHeight - 7) / 2, width: 7, height: 7))
        vitalityIndicatorDot.wantsLayer = true
        vitalityIndicatorDot.layer?.cornerRadius = 3.5
        vitalityIndicatorDot.layer?.backgroundColor = NSColor.systemGreen.cgColor
        containerView.addSubview(vitalityIndicatorDot)

        // 2. Main Metric Label (Modern typography)
        primaryMetricLabel = NSTextField(frame: NSRect(x: 23, y: (panelHeight - 16) / 2 - 1, width: 110, height: 16))
        primaryMetricLabel.isEditable = false
        primaryMetricLabel.isSelectable = false
        primaryMetricLabel.isBezeled = false
        primaryMetricLabel.drawsBackground = false
        primaryMetricLabel.textColor = NSColor.white
        primaryMetricLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
        primaryMetricLabel.stringValue = "Loading..."
        containerView.addSubview(primaryMetricLabel)
    }

    private func toggleDisplayView() {
        displayModeIndex = (displayModeIndex + 1) % 2
        if let statusData = cachedStatusData {
            updateUserInterface(with: statusData)
        }
    }

    private func determineProUser(snapshot: QuotaSnapshotDTO) -> Bool {
        if let forced = forceProMode {
            return forced
        }
        let plan = snapshot.planType?.lowercased() ?? ""
        if plan.contains("pro") {
            return true
        }
        // If 5-hour window is null or 0% while weekly has activity
        if snapshot.fiveHour == nil {
            return true
        }
        return false
    }

    private func buildContextMenu() -> NSMenu {
        let menu = NSMenu(title: "Codex HUD")

        let planName = cachedStatusData?.snapshot.planType ?? "Pro"
        let headerTitle = "Codex Token Monitor (\(planName))"
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

        let webItem = NSMenuItem(title: "Open Web Dashboard", action: #selector(openWebDashboard), keyEquivalent: "d")
        webItem.target = self
        menu.addItem(webItem)

        let refreshItem = NSMenuItem(title: "Force Refresh", action: #selector(forceRefreshData), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)

        menu.addItem(NSMenuItem.separator())

        let isPro = cachedStatusData?.snapshot != nil ? determineProUser(snapshot: cachedStatusData!.snapshot) : true
        let toggleModeTitle = isPro ? "Switch to Standard View (5h + Weekly)" : "Switch to Pro View (Weekly Only)"
        let toggleModeItem = NSMenuItem(title: toggleModeTitle, action: #selector(toggleProModeOverride), keyEquivalent: "")
        toggleModeItem.target = self
        menu.addItem(toggleModeItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Quit Codex HUD", action: #selector(terminateApplication), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        return menu
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
        if let current = forceProMode {
            forceProMode = !current
        } else {
            let isPro = cachedStatusData?.snapshot != nil ? determineProUser(snapshot: cachedStatusData!.snapshot) : true
            forceProMode = !isPro
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
        let isProUser = determineProUser(snapshot: snapshot)

        // Token Feeding animation check
        if previousTotalTokens > 0 && summary.totalTokens > previousTotalTokens {
            latestIncrementTokens = summary.totalTokens - previousTotalTokens
            feedingAnimationCountdown = 3
        } else if feedingAnimationCountdown > 0 {
            feedingAnimationCountdown -= 1
        }
        previousTotalTokens = summary.totalTokens

        let weeklyRemaining = Int(snapshot.weekly?.remainingPercent ?? 100)
        let fiveHourRemaining = Int(snapshot.fiveHour?.remainingPercent ?? 100)

        // Color status logic
        let effectiveRemaining = isProUser ? weeklyRemaining : min(weeklyRemaining, fiveHourRemaining)
        if feedingAnimationCountdown > 0 {
            vitalityIndicatorDot.layer?.backgroundColor = NSColor.systemTeal.cgColor
        } else if effectiveRemaining >= 50 {
            vitalityIndicatorDot.layer?.backgroundColor = NSColor.systemGreen.cgColor
        } else if effectiveRemaining >= 20 {
            vitalityIndicatorDot.layer?.backgroundColor = NSColor.systemYellow.cgColor
        } else {
            vitalityIndicatorDot.layer?.backgroundColor = NSColor.systemRed.cgColor
        }

        // Text & Layout formatting
        var displayString = ""
        var targetWidth: CGFloat = 138

        if feedingAnimationCountdown > 0 {
            displayString = "+\(formatTokenCount(tokens: latestIncrementTokens))"
            primaryMetricLabel.textColor = NSColor.systemTeal
        } else {
            primaryMetricLabel.textColor = NSColor.white

            if displayModeIndex == 1 {
                // Secondary View: Today's Tokens
                displayString = "\(formatTokenCount(tokens: summary.totalTokens))"
                targetWidth = 142
            } else {
                // Primary Quota View
                if isProUser {
                    // Pro user: Only display weekly quota (No useless 5h 100%)
                    displayString = "7d: \(weeklyRemaining)%"
                    targetWidth = 126
                } else {
                    // Non-Pro user: Display both 5h and weekly quota
                    displayString = "5h: \(fiveHourRemaining)% · 7d: \(weeklyRemaining)%"
                    targetWidth = 196
                }
            }
        }

        primaryMetricLabel.stringValue = displayString

        // Smooth width adjustment if layout mode changes
        let currentFrame = floatingPanel.frame
        if abs(currentFrame.width - targetWidth) > 1 {
            let newX = currentFrame.origin.x + (currentFrame.width - targetWidth) / 2
            let newRect = NSRect(x: newX, y: currentFrame.origin.y, width: targetWidth, height: 28)
            floatingPanel.setFrame(newRect, display: true, animate: false)
            containerView.frame = NSRect(x: 0, y: 0, width: targetWidth, height: 28)
            primaryMetricLabel.frame = NSRect(x: 23, y: (28 - 16) / 2 - 1, width: targetWidth - 28, height: 16)
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
