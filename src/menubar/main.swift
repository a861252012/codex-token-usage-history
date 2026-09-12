import Cocoa
import Foundation

func dashboardMatchesProfile(_ dataDirectory: String?, _ codexDirectory: String) -> Bool {
    guard let directory = dataDirectory, !directory.isEmpty else { return false }
    return URL(fileURLWithPath: directory).standardizedFileURL.resolvingSymlinksInPath().path
        == URL(fileURLWithPath: codexDirectory).standardizedFileURL.resolvingSymlinksInPath().path
}

// 型別結構定義
struct QuotaWindowDTO: Codable {
    let usedPercent: Double
    let remainingPercent: Double
    let limitWindowSeconds: Int?
    let resetAfterSeconds: Int?
    let resetCountdown: String
}

struct QuotaSnapshotDTO: Codable {
    let updatedAt: Int64?
    let email: String?
    let planType: String?
    let fiveHour: QuotaWindowDTO?
    let weekly: QuotaWindowDTO?
    let resetCredits: Int?
    let resetCreditsKnown: Bool?
    let source: String?
    let errorReason: String?
}

struct TodaySummaryDTO: Codable {
    let requests: Int
    let totalTokens: Int
    let inputTokens: Int
    let outputTokens: Int
    let hourlyBurnRate: Int
    let formattedCostUsd: String?
}

struct RecentRecordDTO: Codable {
    let datetime: String
    let model: String
    let totalTokens: Int
    let weeklyUsedPct: Double?
}

struct StatusOutputDTO: Codable {
    var dataDirectory: String? = nil
    let snapshot: QuotaSnapshotDTO
    let todaySummary: TodaySummaryDTO
    let recentRecords: [RecentRecordDTO]
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var updateTimer: Timer?
    let homeDir = FileManager.default.homeDirectoryForCurrentUser.path
    let codexDirectoryPath = ProcessInfo.processInfo.environment["CODEX_HOME"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex").path

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.title = "[Codex: 載入中...]"
        }

        refreshData()

        // 每 30 秒自動更新一次
        updateTimer = Timer.scheduledTimer(withTimeInterval: 30.0, repeats: true) { [weak self] _ in
            self?.refreshData()
        }
    }

    func formatNumber(_ n: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: n)) ?? "\(n)"
    }

    func hasValidUpdatedAt(_ timestampMilliseconds: Int64?) -> Bool {
        guard let timestampMilliseconds = timestampMilliseconds, timestampMilliseconds > 0 else { return false }
        return timestampMilliseconds <= Int64(Date().timeIntervalSince1970 * 1000)
    }

    func isLiveSnapshot(_ snapshot: QuotaSnapshotDTO) -> Bool {
        guard snapshot.source == "wham",
              (snapshot.errorReason ?? "").isEmpty,
              hasValidUpdatedAt(snapshot.updatedAt),
              let updatedAt = snapshot.updatedAt else {
            return false
        }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return now - updatedAt <= 120_000
    }

    func sourceDescription(_ snapshot: QuotaSnapshotDTO) -> String {
        switch snapshot.source {
        case "wham": return isLiveSnapshot(snapshot) ? "官方 API" : "官方 API（非即時）"
        case "cache": return "本機快取（非即時）"
        case "fallback": return "離線備援（非即時）"
        default: return "未知來源"
        }
    }

    func formatUpdatedAt(_ timestampMilliseconds: Int64?) -> String {
        guard hasValidUpdatedAt(timestampMilliseconds), let timestampMilliseconds = timestampMilliseconds else { return "未知" }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(timestampMilliseconds) / 1000.0))
    }

    func asLocalCache(_ snapshot: QuotaSnapshotDTO) -> QuotaSnapshotDTO {
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
                : "即時服務與 CLI 無法使用，顯示最後快照"
        )
    }

    @objc func refreshData() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            var statusData: StatusOutputDTO? = nil

            // 1. 優先請求一站式綜合狀態端點 (/api/status)
            if let url = URL(string: "http://127.0.0.1:10200/api/status") {
                var request = URLRequest(url: url)
                request.timeoutInterval = 1.0
                let semaphore = DispatchSemaphore(value: 0)
                let task = URLSession.shared.dataTask(with: request) { data, _, _ in
                    if let d = data, let fullStatus = try? JSONDecoder().decode(StatusOutputDTO.self, from: d),
                       dashboardMatchesProfile(fullStatus.dataDirectory, self.codexDirectoryPath) {
                        statusData = fullStatus
                    }
                    semaphore.signal()
                }
                task.resume()
                _ = semaphore.wait(timeout: .now() + 1.2)
            }

            // 2. 若背景伺服器未運行，以 CLI status --json 為備援快速取得完整資料
            if statusData == nil {
                let adjacentCLI = Bundle.main.executableURL?.resolvingSymlinksInPath().deletingLastPathComponent().appendingPathComponent("codex-usage").path
                let cliPath = [adjacentCLI, "\(self.homeDir)/.local/bin/codex-usage"].compactMap { $0 }.first { FileManager.default.isExecutableFile(atPath: $0) } ?? ""
                if FileManager.default.isExecutableFile(atPath: cliPath) {
                    let pipe = Pipe()
                    let proc = Process()
                    proc.executableURL = URL(fileURLWithPath: cliPath)
                    proc.arguments = ["status", "--json"]
                    proc.standardOutput = pipe
                    try? proc.run()
                    proc.waitUntilExit()

                    let data = pipe.fileHandleForReading.readDataToEndOfFile()
                    if let fullStatus = try? JSONDecoder().decode(StatusOutputDTO.self, from: data) {
                        statusData = fullStatus
                    }
                }
            }

            // 3. 仍失敗時退守本機快照檔案
            if statusData == nil {
                let cacheFile = URL(fileURLWithPath: "\(self.codexDirectoryPath)/codex_quota_snapshot.json")
                if let d = try? Data(contentsOf: cacheFile),
                   let snap = try? JSONDecoder().decode(QuotaSnapshotDTO.self, from: d) {
                    statusData = StatusOutputDTO(
                        snapshot: self.asLocalCache(snap),
                        todaySummary: TodaySummaryDTO(requests: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, hourlyBurnRate: 0, formattedCostUsd: nil),
                        recentRecords: []
                    )
                }
            }

            DispatchQueue.main.async {
                self.updateUI(with: statusData)
            }
        }
    }

    func updateUI(with data: StatusOutputDTO?) {
        guard let data = data else {
            statusItem.button?.title = "[Codex: 未連線]"
            let menu = NSMenu()
            menu.addItem(NSMenuItem(title: "Codex 狀態: 未連線", action: nil, keyEquivalent: ""))
            menu.addItem(NSMenuItem.separator())
            menu.addItem(NSMenuItem(title: "立即重新整理", action: #selector(refreshData), keyEquivalent: "r"))
            menu.addItem(NSMenuItem(title: "結束", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
            statusItem.menu = menu
            return
        }

        let quotaSnapshot = data.snapshot
        var titleParts: [String] = []
        var alertActive = false

        if let fiveHourWindow = quotaSnapshot.fiveHour {
            let remainingPercent = Int(fiveHourWindow.remainingPercent)
            titleParts.append("5h: \(remainingPercent)%")
            if remainingPercent <= 20 {
                alertActive = true
            }
        }
        if let weeklyWindow = quotaSnapshot.weekly {
            let remainingPercent = Int(weeklyWindow.remainingPercent)
            titleParts.append("7d: \(remainingPercent)%")
            if remainingPercent <= 15 {
                alertActive = true
            }
        }

        let alertPrefix = alertActive ? "[!] " : ""
        let sourcePrefix = isLiveSnapshot(quotaSnapshot)
            ? ""
            : quotaSnapshot.source == "cache" ? "快取 · "
            : quotaSnapshot.source == "fallback" ? "離線 · " : "非即時 · "
        let statusTitle = titleParts.isEmpty
            ? "[Codex: \(sourcePrefix)配額資料缺少]"
            : "\(alertPrefix)[\(sourcePrefix)\(titleParts.joined(separator: " | "))]"
        statusItem.button?.title = statusTitle

        // 構建下拉選單
        let menu = NSMenu()

        let planTitle = "Codex 配額監控 (\(quotaSnapshot.planType ?? "未知方案"))"
        let headerItem = NSMenuItem(title: planTitle, action: nil, keyEquivalent: "")
        headerItem.isEnabled = false
        menu.addItem(headerItem)

        if let email = quotaSnapshot.email {
            let emailItem = NSMenuItem(title: "帳號: \(email)", action: nil, keyEquivalent: "")
            emailItem.isEnabled = false
            menu.addItem(emailItem)
        }

        let sourceItem = NSMenuItem(title: "資料來源: \(sourceDescription(quotaSnapshot))", action: nil, keyEquivalent: "")
        sourceItem.isEnabled = false
        menu.addItem(sourceItem)

        let updatedItem = NSMenuItem(title: "資料更新: \(formatUpdatedAt(quotaSnapshot.updatedAt))", action: nil, keyEquivalent: "")
        updatedItem.isEnabled = false
        menu.addItem(updatedItem)

        if let reason = quotaSnapshot.errorReason, !reason.isEmpty {
            let reasonItem = NSMenuItem(title: "狀態說明: \(reason)", action: nil, keyEquivalent: "")
            reasonItem.isEnabled = false
            menu.addItem(reasonItem)
        }

        menu.addItem(NSMenuItem.separator())

        // 5小時時間視窗
        if let fiveHourWindow = quotaSnapshot.fiveHour {
            let item = NSMenuItem(title: "五小時額度: 剩餘 \(Int(fiveHourWindow.remainingPercent))% (已用 \(Int(fiveHourWindow.usedPercent))% · 重設: \(fiveHourWindow.resetCountdown))", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        } else {
            let item = NSMenuItem(title: "五小時額度: 無資料", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }

        // 週用量時間視窗
        if let weeklyWindow = quotaSnapshot.weekly {
            let item = NSMenuItem(title: "週用量額度: 剩餘 \(Int(weeklyWindow.remainingPercent))% (已用 \(Int(weeklyWindow.usedPercent))% · 重設: \(weeklyWindow.resetCountdown))", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        } else {
            let item = NSMenuItem(title: "週用量額度: 無資料", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }

        if quotaSnapshot.resetCreditsKnown == true,
           let credits = quotaSnapshot.resetCredits,
           credits > 0 {
            let creditMenuItem = NSMenuItem(title: "重設信用額度: \(credits) 次可用", action: nil, keyEquivalent: "")
            creditMenuItem.isEnabled = false
            menu.addItem(creditMenuItem)
        }

        menu.addItem(NSMenuItem.separator())

        // 本日消耗真實統計 (非假資料)
        let todaySummary = data.todaySummary
        if todaySummary.requests > 0 || todaySummary.totalTokens > 0 {
            let recordCountMenuItem = NSMenuItem(title: "本日紀錄筆數: \(formatNumber(todaySummary.requests)) 筆", action: nil, keyEquivalent: "")
            recordCountMenuItem.isEnabled = false
            menu.addItem(recordCountMenuItem)

            let costText = todaySummary.formattedCostUsd != nil ? " (~\(todaySummary.formattedCostUsd!) USD)" : ""
            let summaryMenuItem = NSMenuItem(title: "本日消耗總計: \(formatNumber(todaySummary.totalTokens)) tokens\(costText)", action: nil, keyEquivalent: "")
            summaryMenuItem.isEnabled = false
            menu.addItem(summaryMenuItem)

            let inputOutputMenuItem = NSMenuItem(title: "輸入/輸出: \(formatNumber(todaySummary.inputTokens)) / \(formatNumber(todaySummary.outputTokens))", action: nil, keyEquivalent: "")
            inputOutputMenuItem.isEnabled = false
            menu.addItem(inputOutputMenuItem)

            let burnRateMenuItem = NSMenuItem(title: "過去1小時燃燒率: \(formatNumber(todaySummary.hourlyBurnRate)) tokens/hr", action: nil, keyEquivalent: "")
            burnRateMenuItem.isEnabled = false
            menu.addItem(burnRateMenuItem)

            menu.addItem(NSMenuItem.separator())
        }

        // 近期流水帳紀錄 (最新 3 筆)
        if !data.recentRecords.isEmpty {
            let recordHeaderMenuItem = NSMenuItem(title: "近期 Token 消耗流水帳:", action: nil, keyEquivalent: "")
            recordHeaderMenuItem.isEnabled = false
            menu.addItem(recordHeaderMenuItem)

            for singleRecord in data.recentRecords.prefix(3) {
                let shortTime = singleRecord.datetime.replacingOccurrences(of: "T", with: " ").prefix(19)
                let recordMenuItem = NSMenuItem(title: "  \(shortTime) - \(singleRecord.model): \(formatNumber(singleRecord.totalTokens))", action: nil, keyEquivalent: "")
                recordMenuItem.isEnabled = false
                menu.addItem(recordMenuItem)
            }

            menu.addItem(NSMenuItem.separator())
        }

        // 操作選項
        let webItem = NSMenuItem(title: "開啟 Web 歷史儀表板", action: #selector(openWebDashboard), keyEquivalent: "o")
        menu.addItem(webItem)

        let refreshItem = NSMenuItem(title: "立即重新整理", action: #selector(refreshData), keyEquivalent: "r")
        menu.addItem(refreshItem)

        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "結束", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        statusItem.menu = menu
    }

    @objc func openWebDashboard() {
        let url = URL(string: "http://127.0.0.1:10200")!
        var request = URLRequest(url: url.appendingPathComponent("api/diagnostics"))
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard let data = data,
                      let diagnostics = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      dashboardMatchesProfile(diagnostics["dataDirectory"] as? String, self.codexDirectoryPath) else {
                    let alert = NSAlert()
                    alert.messageText = "無法開啟此帳號的儀表板"
                    alert.informativeText = "請確認目前 CODEX_HOME 的 dashboard 服務已啟動；10200 可能由其他資料目錄或舊版服務使用。"
                    alert.runModal()
                    return
                }
                NSWorkspace.shared.open(url)
            }
        }.resume()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
