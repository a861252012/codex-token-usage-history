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
            button.title = "[Codex 載入中...]"
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

            // 優先讀取 local HTTP API，若未開啟則讀取本機快取檔案
            var statusData: StatusOutputDTO? = nil

            if let url = URL(string: "http://127.0.0.1:10200/api/quota") {
                var request = URLRequest(url: url)
                request.timeoutInterval = 1.0
                let semaphore = DispatchSemaphore(value: 0)
                let task = URLSession.shared.dataTask(with: request) { data, _, _ in
                    if let d = data, let snap = try? JSONDecoder().decode(QuotaSnapshotDTO.self, from: d) {
                        statusData = StatusOutputDTO(
                            snapshot: snap,
                            todaySummary: TodaySummaryDTO(requests: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, hourlyBurnRate: 0),
                            recentRecords: []
                        )
                    }
                    semaphore.signal()
                }
                task.resume()
                _ = semaphore.wait(timeout: .now() + 1.2)
            }

            // 若 HTTP 伺服器未運行，直接讀取快取檔案
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

        if let p5 = snap.fiveHour {
            titleParts.append("5h: \(Int(p5.remainingPercent))%")
        }
        if let pw = snap.weekly {
            titleParts.append("7d: \(Int(pw.remainingPercent))%")
        }

        let statusTitle = titleParts.isEmpty ? "[Codex 在線]" : "[\(titleParts.joined(separator: " | "))]"
        statusItem.button?.title = statusTitle

        // 構建下拉選單
        let menu = NSMenu()

        let planTitle = "Codex 配額監控 (\(snap.planType ?? "prolite"))"
        let headerItem = NSMenuItem(title: planTitle, action: nil, keyEquivalent: "")
        headerItem.isEnabled = false
        menu.addItem(headerItem)

        if let email = snap.email {
            let emailItem = NSMenuItem(title: "帳號: \(email)", action: nil, keyEquivalent: "")
            emailItem.isEnabled = false
            menu.addItem(emailItem)
        }

        menu.addItem(NSMenuItem.separator())

        // 5小時窗口
        if let p5 = snap.fiveHour {
            let item = NSMenuItem(title: "五小時額度: 剩餘 \(Int(p5.remainingPercent))% (已用 \(Int(p5.usedPercent))% · 重設: \(p5.resetCountdown))", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        } else {
            let item = NSMenuItem(title: "五小時額度: 未配置短窗口限制", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }

        // 週用量窗口
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

        // 動作項目
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
