import Cocoa
import Foundation

// 型別結構定義
struct QuotaWindowDTO: Codable {
    let usedPercent: Double
    let remainingPercent: Double
    let limitWindowSeconds: Int
    let resetAfterSeconds: Int
    let resetCountdown: String
}

struct QuotaSnapshotDTO: Codable {
    let email: String?
    let planType: String?
    let fiveHour: QuotaWindowDTO?
    let weekly: QuotaWindowDTO?
    let resetCredits: Int
}

struct TodaySummaryDTO: Codable {
    let requests: Int
    let totalTokens: Int
    let inputTokens: Int
    let outputTokens: Int
    let hourlyBurnRate: Int
}

struct RecentRecordDTO: Codable {
    let datetime: String
    let model: String
    let totalTokens: Int
    let weeklyUsedPct: Double?
}

struct StatusOutputDTO: Codable {
    let snapshot: QuotaSnapshotDTO
    let todaySummary: TodaySummaryDTO
    let recentRecords: [RecentRecordDTO]
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var updateTimer: Timer?
    let homeDir = FileManager.default.homeDirectoryForCurrentUser.path

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
                    if let d = data, let fullStatus = try? JSONDecoder().decode(StatusOutputDTO.self, from: d) {
                        statusData = fullStatus
                    }
                    semaphore.signal()
                }
                task.resume()
                _ = semaphore.wait(timeout: .now() + 1.2)
            }

            // 2. 若背景伺服器未運行，以 CLI status --json 為備援快速取得完整資料
            if statusData == nil {
                let cliPath = "\(self.homeDir)/.local/bin/codex-usage"
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
                let cacheFile = URL(fileURLWithPath: "\(self.homeDir)/.codex/codex_quota_snapshot.json")
                if let d = try? Data(contentsOf: cacheFile),
                   let snap = try? JSONDecoder().decode(QuotaSnapshotDTO.self, from: d) {
                    statusData = StatusOutputDTO(
                        snapshot: snap,
                        todaySummary: TodaySummaryDTO(requests: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, hourlyBurnRate: 0),
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

        let snap = data.snapshot
        var titleParts: [String] = []
        var hasAlert = false

        if let p5 = snap.fiveHour {
            let rem = Int(p5.remainingPercent)
            titleParts.append("5h: \(rem)%")
            if rem <= 20 {
                hasAlert = true
            }
        }
        if let pw = snap.weekly {
            let rem = Int(pw.remainingPercent)
            titleParts.append("7d: \(rem)%")
            if rem <= 15 {
                hasAlert = true
            }
        }

        let alertPrefix = hasAlert ? "[!] " : ""
        let statusTitle = titleParts.isEmpty ? "[Codex 在線]" : "\(alertPrefix)[\(titleParts.joined(separator: " | "))]"
        statusItem.button?.title = statusTitle

        // 構建下拉選單
        let menu = NSMenu()

        let planTitle = "Codex 配額即時監控 (\(snap.planType ?? "prolite"))"
        let headerItem = NSMenuItem(title: planTitle, action: nil, keyEquivalent: "")
        headerItem.isEnabled = false
        menu.addItem(headerItem)

        if let email = snap.email {
            let emailItem = NSMenuItem(title: "帳號: \(email)", action: nil, keyEquivalent: "")
            emailItem.isEnabled = false
            menu.addItem(emailItem)
        }

        menu.addItem(NSMenuItem.separator())

        // 5小時時間視窗
        if let p5 = snap.fiveHour {
            let item = NSMenuItem(title: "五小時額度: 剩餘 \(Int(p5.remainingPercent))% (已用 \(Int(p5.usedPercent))% · 重設: \(p5.resetCountdown))", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        } else {
            let item = NSMenuItem(title: "五小時額度: 未配置短週期視窗限制", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }

        // 週用量時間視窗
        if let pw = snap.weekly {
            let item = NSMenuItem(title: "週用量額度: 剩餘 \(Int(pw.remainingPercent))% (已用 \(Int(pw.usedPercent))% · 重設: \(pw.resetCountdown))", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }

        if snap.resetCredits > 0 {
            let credItem = NSMenuItem(title: "重設信用額度: \(snap.resetCredits) 次可用", action: nil, keyEquivalent: "")
            credItem.isEnabled = false
            menu.addItem(credItem)
        }

        menu.addItem(NSMenuItem.separator())

        // 本日消耗真實統計 (非假資料)
        let sum = data.todaySummary
        if sum.requests > 0 || sum.totalTokens > 0 {
            let sumItem = NSMenuItem(title: "本日消耗總計: \(formatNumber(sum.totalTokens)) tokens (\(formatNumber(sum.requests)) 次請求)", action: nil, keyEquivalent: "")
            sumItem.isEnabled = false
            menu.addItem(sumItem)

            let inOutItem = NSMenuItem(title: "輸入/輸出: \(formatNumber(sum.inputTokens)) / \(formatNumber(sum.outputTokens))", action: nil, keyEquivalent: "")
            inOutItem.isEnabled = false
            menu.addItem(inOutItem)

            let burnItem = NSMenuItem(title: "過去1小時燃燒率: \(formatNumber(sum.hourlyBurnRate)) tokens/hr", action: nil, keyEquivalent: "")
            burnItem.isEnabled = false
            menu.addItem(burnItem)

            menu.addItem(NSMenuItem.separator())
        }

        // 近期流水帳紀錄 (最新 3 筆)
        if !data.recentRecords.isEmpty {
            let recHeader = NSMenuItem(title: "近期 Token 消耗流水帳:", action: nil, keyEquivalent: "")
            recHeader.isEnabled = false
            menu.addItem(recHeader)

            for r in data.recentRecords.prefix(3) {
                let shortTime = r.datetime.replacingOccurrences(of: "T", with: " ").prefix(19)
                let recItem = NSMenuItem(title: "  \(shortTime) - \(r.model): \(formatNumber(r.totalTokens))", action: nil, keyEquivalent: "")
                recItem.isEnabled = false
                menu.addItem(recItem)
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
        if let url = URL(string: "http://127.0.0.1:10200") {
            NSWorkspace.shared.open(url)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
