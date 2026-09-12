import Foundation

final class RoomSocket: ObservableObject {
  let deviceId: String

  @Published var connected = false
  @Published var error: String?
  @Published var tokens: [String: String] = [:]
  @Published var devices: [String: Device] = [:]
  @Published var originId: String?
  @Published var rightId: String?
  @Published var gx: Double?
  @Published var gy: Double?
  @Published var ranges: [String: Double] = [:]

  var onReady: (() -> Void)?

  private var task: URLSessionWebSocketTask?
  private var code = ""
  private var pending: [String] = []
  private var generation = 0

  struct Device {
    var worldX: Int
    var worldY: Int
    var color: String
    var status: String
  }

  init(deviceId: String) {
    self.deviceId = deviceId
  }

  func connect(wsURL: URL, code: String, create: Bool, name: String) {
    self.code = code.uppercased()
    error = nil
    generation += 1
    let gen = generation
    task?.cancel(with: .goingAway, reason: nil)
    let session = URLSession(configuration: .default)
    let socket = session.webSocketTask(with: wsURL)
    task = socket
    socket.resume()
    connected = true
    listen(gen)
    send([
      "type": "join",
      "code": self.code,
      "deviceId": deviceId,
      "createIfMissing": create,
      "native": true,
      "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
    ])
    flush()
    onReady?()
  }

  func sendToken(_ token: String) {
    send(["type": "ni-token", "token": token])
  }

  func sendRange(to toId: String, distance: Float, dx: Float?, dy: Float?, dz: Float?) {
    var payload: [String: Any] = [
      "type": "uwb-range",
      "toId": toId,
      "distance": distance,
    ]
    if let dx, let dy, let dz {
      payload["dx"] = dx
      payload["dy"] = dy
      payload["dz"] = dz
    }
    send(payload)
  }

  func sendStatus(_ status: String, carryX: Double = 0, carryY: Double = 0) {
    var payload: [String: Any] = ["type": "status", "status": status]
    if status == "table" {
      payload["carryX"] = carryX
      payload["carryY"] = carryY
    }
    send(payload)
  }

  private func send(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let text = String(data: data, encoding: .utf8)
    else { return }
    pending.append(text)
    flush()
  }

  private func flush() {
    guard let task else { return }
    let queued = pending
    pending.removeAll()
    for text in queued {
      task.send(.string(text)) { [weak self] error in
        if let error {
          DispatchQueue.main.async { self?.error = error.localizedDescription }
        }
      }
    }
  }

  private func listen(_ gen: Int) {
    task?.receive { [weak self] result in
      guard let self, gen == self.generation else { return }
      switch result {
      case .failure:
        DispatchQueue.main.async {
          guard gen == self.generation else { return }
          self.connected = false
        }
      case .success(let message):
        if case let .string(text) = message {
          self.handle(text)
        }
        self.listen(gen)
      }
    }
  }

  private func handle(_ text: String) {
    guard let data = text.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = json["type"] as? String
    else { return }

    DispatchQueue.main.async {
      if type == "error" {
        self.error = json["message"] as? String ?? "Room error"
        return
      }
      if type == "ni-tokens" {
        self.tokens = json["tokens"] as? [String: String] ?? [:]
        return
      }
      if type == "state", let room = json["room"] as? [String: Any] {
        self.parseRoom(room)
      }
    }
  }

  private func parseRoom(_ room: [String: Any]) {
    var next: [String: Device] = [:]
    if let raw = room["devices"] as? [String: Any] {
      for (id, value) in raw {
        guard let value = value as? [String: Any] else { continue }
        next[id] = Device(
          worldX: Self.intValue(value["worldX"]),
          worldY: Self.intValue(value["worldY"]),
          color: value["color"] as? String ?? "#888888",
          status: value["status"] as? String ?? "table"
        )
      }
    }
    devices = next
    if let uwb = room["uwb"] as? [String: Any] {
      originId = uwb["originId"] as? String
      rightId = uwb["rightId"] as? String
      gx = uwb["gx"] as? Double ?? (uwb["gx"] as? Int).map { Double($0) }
      gy = uwb["gy"] as? Double ?? (uwb["gy"] as? Int).map { Double($0) }
      if let raw = uwb["ranges"] as? [String: Any] {
        var next: [String: Double] = [:]
        for (key, value) in raw {
          if let number = value as? Double { next[key] = number }
          else if let number = value as? Int { next[key] = Double(number) }
        }
        ranges = next
      }
    }
  }

  private static func intValue(_ any: Any?) -> Int {
    if let value = any as? Int { return value }
    if let value = any as? Double { return Int(value) }
    return 0
  }
}
