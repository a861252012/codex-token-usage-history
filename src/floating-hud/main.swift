import Cocoa
import Foundation

// MARK: - 資料模型定義 (語意明確，杜絕縮寫)

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
}

struct TokenRecordDTO: Codable {
    let timestamp: Int64
    let datetime: String
    let model: String
    let totalTokens: Int
    let weeklyUsedPct: Double?
}

// MARK: - 點擊互動毛玻璃面板 (支援點選切換心情面板)

class InteractiveEffectView: NSVisualEffectView {
    var clickActionHandler: (() -> Void)?

    override func mouseUp(with event: NSEvent) {
        let clickLocation = convert(event.locationInWindow, from: nil)
        // 排除右上角關閉按鈕區域 (最右側 30px)
        if clickLocation.x < bounds.width - 30 {
            clickActionHandler?()
        } else {
            super.mouseUp(with: event)
        }
    }
}

// MARK: - 浮動視窗面板 (Always-on-Top Floating Panel)

class FloatingHudPanel: NSPanel {
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

// MARK: - 應用程式主委派 (Application Delegate)

class AppDelegate: NSObject, NSApplicationDelegate {
    private var floatingPanel: FloatingHudPanel!
    private var containerView: InteractiveEffectView!

    // 寵物狀態與指示燈
    private var companionVitalityDot: NSView!
    private var companionMoodLabel: NSTextField!
    private var firstMetricLabel: NSTextField!
    private var secondMetricLabel: NSTextField!
    private var thirdMetricLabel: NSTextField!
    private var feedingActivityLabel: NSTextField!
    private var closeButton: NSButton!

    private var refreshTimer: Timer?
    private let homeDirectoryPath = FileManager.default.homeDirectoryForCurrentUser.path
    private var previousTotalTokens: Int = 0
    private var feedingAnimationCountdown: Int = 0
    private var latestIncrementTokens: Int = 0
    private var displayModeIndex: Int = 0 // 0: 配額模式, 1: 戰報模式

    // 快取最新狀態資料以供點擊即時切換
    private var cachedStatusData: FullStatusDTO?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupFloatingWindow()
        loadLatestData()
        startPeriodicTimer()
    }

    private func setupFloatingWindow() {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let panelWidth: CGFloat = 560
        let panelHeight: CGFloat = 38
        let initialX = screenFrame.origin.x + (screenFrame.width - panelWidth) / 2
        let initialY = screenFrame.origin.y + screenFrame.height - panelHeight - 14

        let panelRect = NSRect(x: initialX, y: initialY, width: panelWidth, height: panelHeight)
        floatingPanel = FloatingHudPanel(contentRect: panelRect)

        // 膠囊毛玻璃主容器
        containerView = InteractiveEffectView(frame: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight))
        containerView.material = .hudWindow
        containerView.blendingMode = .behindWindow
        containerView.state = .active
        containerView.wantsLayer = true
        containerView.layer?.cornerRadius = 19
        containerView.layer?.masksToBounds = true
        containerView.layer?.borderColor = NSColor.white.withAlphaComponent(0.18).cgColor
        containerView.layer?.borderWidth = 1.0

        // 綁定點擊寵物切換心情面板
        containerView.clickActionHandler = { [weak self] in
            self?.toggleDisplayMode()
        }

        buildSubviews(panelWidth: panelWidth, panelHeight: panelHeight)

        floatingPanel.contentView = containerView
        floatingPanel.makeKeyAndOrderFront(nil)
    }

    private func buildSubviews(panelWidth: CGFloat, panelHeight: CGFloat) {
        // 1. 寵物狀態指示燈
        companionVitalityDot = NSView(frame: NSRect(x: 14, y: (panelHeight - 8) / 2, width: 8, height: 8))
        companionVitalityDot.wantsLayer = true
        companionVitalityDot.layer?.cornerRadius = 4
        companionVitalityDot.layer?.backgroundColor = NSColor.systemGreen.cgColor
        containerView.addSubview(companionVitalityDot)

        // 2. 寵物稱號與狀態 (例如 [活力飽滿] 或 [正在進食 +42k])
        companionMoodLabel = createTextLabel(xPosition: 28, yPosition: 10, width: 125, height: 18)
        companionMoodLabel.font = NSFont.systemFont(ofSize: 12, weight: .bold)
        companionMoodLabel.stringValue = "[Codex 寵物] 甦醒中"
        companionMoodLabel.textColor = NSColor.systemGreen
        containerView.addSubview(companionMoodLabel)

        // 分隔線 1
        let separatorOne = createVerticalSeparator(xPosition: 156, panelHeight: panelHeight)
        containerView.addSubview(separatorOne)

        // 3. 第一項指標 (5小時額度 或 今日請求數)
        firstMetricLabel = createTextLabel(xPosition: 168, yPosition: 10, width: 95, height: 18)
        firstMetricLabel.stringValue = "5h: 100%"
        containerView.addSubview(firstMetricLabel)

        // 分隔線 2
        let separatorTwo = createVerticalSeparator(xPosition: 265, panelHeight: panelHeight)
        containerView.addSubview(separatorTwo)

        // 4. 第二項指標 (週用量額度 或 燃燒率)
        secondMetricLabel = createTextLabel(xPosition: 277, yPosition: 10, width: 95, height: 18)
        secondMetricLabel.stringValue = "7d: 100%"
        containerView.addSubview(secondMetricLabel)

        // 分隔線 3
        let separatorThree = createVerticalSeparator(xPosition: 374, panelHeight: panelHeight)
        containerView.addSubview(separatorThree)

        // 5. 第三項指標 (本日累積用量 或 重設倒數)
        thirdMetricLabel = createTextLabel(xPosition: 386, yPosition: 10, width: 140, height: 18)
        thirdMetricLabel.stringValue = "本日: 0 tokens"
        containerView.addSubview(thirdMetricLabel)

        // 6. 關閉按鈕
        closeButton = NSButton(frame: NSRect(x: panelWidth - 26, y: (panelHeight - 16) / 2, width: 16, height: 16))
        closeButton.bezelStyle = .circular
        closeButton.title = "×"
        closeButton.font = NSFont.systemFont(ofSize: 12, weight: .bold)
        closeButton.isBordered = false
        closeButton.target = self
        closeButton.action = #selector(terminateApplication)
        containerView.addSubview(closeButton)
    }

    private func createVerticalSeparator(xPosition: CGFloat, panelHeight: CGFloat) -> NSView {
        let separator = NSView(frame: NSRect(x: xPosition, y: 8, width: 1, height: panelHeight - 16))
        separator.wantsLayer = true
        separator.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.12).cgColor
        return separator
    }

    private func createTextLabel(xPosition: CGFloat, yPosition: CGFloat, width: CGFloat, height: CGFloat) -> NSTextField {
        let label = NSTextField(frame: NSRect(x: xPosition, y: yPosition, width: width, height: height))
        label.isEditable = false
        label.isSelectable = false
        label.isBezeled = false
        label.drawsBackground = false
        label.textColor = NSColor.labelColor
        label.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        return label
    }

    private func toggleDisplayMode() {
        displayModeIndex = (displayModeIndex + 1) % 2
        if let statusData = cachedStatusData {
            updateUserInterface(with: statusData)
        }
    }

    private func startPeriodicTimer() {
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            self?.loadLatestData()
        }
    }

    @objc private func loadLatestData() {
        DispatchQueue.global(qos: .userInteractive).async { [weak self] in
            guard let self = self else { return }

            var fetchedStatus: FullStatusDTO?

            // 1. 優先向本機 HTTP /api/status 請求最新聚合資料
            if let serverUrl = URL(string: "http://127.0.0.1:10200/api/status") {
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

            // 2. 若 HTTP 伺服器未運行，以本機快照檔案為備援
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
            return TodaySummaryDTO(requests: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, hourlyBurnRate: 0)
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
        let startOfDayTimestamp = Int64(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000)
        process.arguments = [
            databasePath,
            "SELECT COUNT(*), COALESCE(SUM(total_tokens), 0), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0) FROM token_records WHERE timestamp >= \(startOfDayTimestamp);"
        ]

        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        try? process.run()
        process.waitUntilExit()

        let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
        if let outputString = String(data: outputData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
            let components = outputString.components(separatedBy: "|")
            if components.count >= 4 {
                let totalRequests = Int(components[0]) ?? 0
                let totalTokens = Int(components[1]) ?? 0
                let inputTokens = Int(components[2]) ?? 0
                let outputTokens = Int(components[3]) ?? 0
                return TodaySummaryDTO(requests: totalRequests, totalTokens: totalTokens, inputTokens: inputTokens, outputTokens: outputTokens, hourlyBurnRate: 0)
            }
        }

        return TodaySummaryDTO(requests: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, hourlyBurnRate: 0)
    }

    private func updateUserInterface(with statusData: FullStatusDTO) {
        let snapshot = statusData.snapshot
        let summary = statusData.todaySummary

        // 偵測 Token 增量跳動 (進食動態反應)
        if previousTotalTokens > 0 && summary.totalTokens > previousTotalTokens {
            latestIncrementTokens = summary.totalTokens - previousTotalTokens
            feedingAnimationCountdown = 3
        } else if feedingAnimationCountdown > 0 {
            feedingAnimationCountdown -= 1
        }
        previousTotalTokens = summary.totalTokens

        // 1. 計算寵物活力狀態與情緒
        let fiveHourRemaining = Int(snapshot.fiveHour?.remainingPercent ?? 100)
        let weeklyRemaining = Int(snapshot.weekly?.remainingPercent ?? 100)
        let minimumQuotaPercent = min(fiveHourRemaining, weeklyRemaining)

        // 若正處於進食反應中，優先顯示進食動態
        if feedingAnimationCountdown > 0 {
            companionMoodLabel.stringValue = "正在進食 +\(formatTokenCount(tokens: latestIncrementTokens))"
            companionMoodLabel.textColor = NSColor.systemTeal
            companionVitalityDot.layer?.backgroundColor = NSColor.systemTeal.cgColor
        } else {
            if minimumQuotaPercent >= 70 {
                companionMoodLabel.stringValue = "[活力飽滿]"
                companionMoodLabel.textColor = NSColor.systemGreen
                companionVitalityDot.layer?.backgroundColor = NSColor.systemGreen.cgColor
            } else if minimumQuotaPercent >= 30 {
                companionMoodLabel.stringValue = "[穩定運作]"
                companionMoodLabel.textColor = NSColor.systemCyan
                companionVitalityDot.layer?.backgroundColor = NSColor.systemCyan.cgColor
            } else if minimumQuotaPercent >= 15 {
                companionMoodLabel.stringValue = "[感到飢餓]"
                companionMoodLabel.textColor = NSColor.systemYellow
                companionVitalityDot.layer?.backgroundColor = NSColor.systemYellow.cgColor
            } else {
                companionMoodLabel.stringValue = "[極度疲憊]"
                companionMoodLabel.textColor = NSColor.systemRed
                companionVitalityDot.layer?.backgroundColor = NSColor.systemRed.cgColor
            }
        }

        // 2. 依據當前顯示模式切換指標展示
        if displayModeIndex == 0 {
            // 模式 0: 配額模式 (Quota View)
            firstMetricLabel.stringValue = "5h: \(fiveHourRemaining)%"
            secondMetricLabel.stringValue = "7d: \(weeklyRemaining)%"
            thirdMetricLabel.stringValue = "本日: \(formatTokenCount(tokens: summary.totalTokens))"
        } else {
            // 模式 1: 戰報模式 (Daily Battle Stats View)
            firstMetricLabel.stringValue = "請求: \(summary.requests)次"
            secondMetricLabel.stringValue = "燃燒: \(formatTokenCount(tokens: summary.hourlyBurnRate))/h"
            let countdownString = snapshot.fiveHour?.resetCountdown ?? "充足"
            thirdMetricLabel.stringValue = "重設: \(countdownString)"
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

// MARK: - 主進入點

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let delegate = AppDelegate()
application.delegate = delegate
application.run()
