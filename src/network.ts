import { RubbleRoster } from "./county-rubble-view.ts";
import { RELEASE_ID } from "./release-info.ts";
import { RUST_SCALE } from "./rust-boundary.ts";
import type { PieceState, V3 } from "./world.ts";
export interface RemoteState {
  engaged?: boolean;
  reaction?: import("./fists.ts").PunchImpact;
  swing?: import("./fists.ts").Punch;
  notoriety?: number;
  fall?: import("./county-incidents.ts").CountyFall;
  action?: "idle" | "shove" | "melee" | "shoot";
  id: string;
  name: string;
  p: V3;
  yaw: number;
  pitch: number;
  hp: number;
  kills: number;
  deaths: number;
  weapon: number;
  height: number;
  anchor: V3 | null;
  npc?: boolean;
  skiddingCar?: number;
  lean?: number;
}
export class Network {
  constructor(private storagePrefix = "dc") {}
  rubble = new RubbleRoster();
  structures = new Map<number, PieceState>();
  socket: WebSocket | null = null;
  id = "";
  code = "";
  active = false;
  public = false;
  duel = false;
  rtt = 0;
  wave: {
    number: number;
    alive: number;
    queued: number;
    nextIn: number;
  } | null = null;
  serverOffset = 0;
  get worldTime() {
    return (Date.now() + this.serverOffset) / 1000;
  }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private roster: { id: string; name: string; npc: boolean }[] = [];
  private samples = new Map<
    string,
    { p: V3; v: V3; time: number; serverTime: number }
  >();
  players: RemoteState[] = [];
  onMessage: (m: any) => void = () => {};
  private session: any = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryUntil = 0;
  private retryCount = 0;
  reconnecting = false;
  private read(key: string) {
    try {
      return JSON.parse(
        sessionStorage.getItem(key.replace(/^dc/, this.storagePrefix)) ||
          "null",
      );
    } catch {
      return null;
    }
  }
  private save(key: string, value: any) {
    try {
      if (value)
        sessionStorage.setItem(
          key.replace(/^dc/, this.storagePrefix),
          JSON.stringify(value),
        );
      else sessionStorage.removeItem(key.replace(/^dc/, this.storagePrefix));
    } catch {
      /* Private browsing may disable storage. */
    }
  }
  private matchingClient(record: any) {
    if (record.releaseId === RELEASE_ID) return;
    const url = new URL(
      record.clientUrl || `/releases/${encodeURIComponent(record.releaseId)}/`,
      location.origin,
    );
    if (
      url.origin !== location.origin ||
      !url.pathname.startsWith(`/releases/${record.releaseId}/`)
    )
      throw Error("This match is unavailable. Please try again.");
    if (this.storagePrefix === "county") url.searchParams.set("mode", "county");
    location.replace(url.href);
    return new Promise<never>(() => {});
  }
  async bootstrap(): Promise<any | null> {
    if (RELEASE_ID === "dev") return null;
    // The county entry opens the selected build. Reloading a pinned match on
    // its own release still resumes it, including after a newer deployment.
    if (this.storagePrefix === "county") {
      for (const key of ["dc.session", "dc.pendingAdmission"]) {
        const record = this.read(key);
        if (record && record.releaseId !== RELEASE_ID) this.save(key, null);
      }
    }
    const saved = this.read("dc.session");
    if (saved) {
      await this.matchingClient(saved);
      this.session = saved;
      this.retryUntil = Date.now() + 90000;
      return this.restore();
    }
    const pending = this.read("dc.pendingAdmission");
    if (pending) {
      await this.matchingClient(pending);
      this.save("dc.pendingAdmission", null);
      return this.open(
        pending.wsUrl,
        {
          type: "admit",
          joinTicket: pending.joinTicket,
          releaseId: RELEASE_ID,
          compact: true,
        },
        pending,
      );
    }
    const code = new URLSearchParams(location.search).get("room");
    if (code && /^[A-Z0-9]{5}$/i.test(code)) {
      const response = await fetch(`/api/matches/${encodeURIComponent(code)}`, {
        cache: "no-store",
      });
      if (!response.ok) throw Error("This invitation is no longer available.");
      const room = await response.json();
      room.clientUrl = `/releases/${room.releaseId}/?room=${encodeURIComponent(code)}`;
      await this.matchingClient(room);
    }
    return null;
  }
  async connect(
    type: "create" | "join" | "public" | "duel",
    name: string,
    seed: string,
    code: string,
  ) {
    this.disconnect();
    if (RELEASE_ID === "dev")
      return this.open("/ws", {
        type,
        name,
        seed,
        code,
        compact: true,
        mapScale: RUST_SCALE,
      });
    const response = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        name,
        seed,
        code,
        requestId: crypto.randomUUID(),
      }),
    });
    if (!response.ok)
      throw Error("Couldn’t join the city. Please try again shortly.");
    const admission = await response.json();
    this.save("dc.pendingAdmission", admission);
    await this.matchingClient(admission);
    this.save("dc.pendingAdmission", null);
    return this.open(
      admission.wsUrl,
      {
        type: "admit",
        joinTicket: admission.joinTicket,
        releaseId: RELEASE_ID,
        compact: true,
      },
      admission,
    );
  }
  private async restore(): Promise<any> {
    if (!this.session) throw Error("Your match has ended.");
    this.reconnecting = true;
    this.session.attemptId ||= crypto.randomUUID();
    this.save("dc.session", this.session);
    try {
      const m = await this.open(
        this.session.wsUrl,
        {
          type: "resume",
          sessionId: this.session.sessionId,
          secret: this.session.resumeSecret,
          attemptId: this.session.attemptId,
          releaseId: RELEASE_ID,
          compact: true,
        },
        this.session,
      );
      this.reconnecting = false;
      this.retryCount = 0;
      return m;
    } catch (error) {
      if (
        !this.session ||
        Date.now() >= this.retryUntil ||
        (error as any).terminal
      ) {
        this.save("dc.session", null);
        this.session = null;
        this.reconnecting = false;
        this.onMessage({ type: "disconnected" });
        throw error;
      }
      await new Promise<void>((resolve) => {
        this.retryTimer = setTimeout(
          resolve,
          Math.min(
            5000,
            250 * 2 ** this.retryCount++ * (0.8 + Math.random() * 0.4),
          ),
        );
      });
      return this.restore();
    }
  }
  private open(wsUrl: string, handshake: any, admission?: any) {
    return new Promise<any>((resolve, reject) => {
      const url = new URL(wsUrl, location.origin);
      if (
        url.origin !== location.origin ||
        !/^\/ws(?:\/[a-zA-Z0-9_-]+)?$/.test(url.pathname)
      ) {
        reject(Error("Invalid match address."));
        return;
      }
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url.href);
      this.socket = ws;
      let done = false;
      const fail = (error: Error) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(error);
          ws.close();
        }
      };
      const timer = setTimeout(
        () => fail(Error("Connection timed out. Please try again.")),
        8000,
      );
      ws.onopen = () => ws.send(JSON.stringify(handshake));
      ws.onerror = () => fail(Error("Could not reach your match."));
      ws.onmessage = (e) => {
        if (this.socket !== ws) return;
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.type === "welcome" || m.type === "resumed") {
          done = true;
          clearTimeout(timer);
          this.rubble.reset();
          for (const c of m.rubble ?? []) this.rubble.add(c);
          this.structures = new Map(m.structures ?? []);
          this.id = m.id;
          this.code = m.code;
          this.active = true;
          this.public = !!m.public;
          this.duel = !!m.duel;
          this.samples.clear();
          this.roster = [];
          this.players = [];
          if (m.sessionId && m.resumeSecret) {
            this.session = {
              wsUrl,
              releaseId: RELEASE_ID,
              clientUrl: admission?.clientUrl,
              sessionId: m.sessionId,
              resumeSecret: m.resumeSecret,
            };
            this.save("dc.session", this.session);
          }
          if (this.pingTimer) clearInterval(this.pingTimer);
          this.pingTimer = setInterval(
            () => this.send({ type: "ping", time: performance.now() }),
            1000,
          );
          resolve(m);
        } else if (m.type === "error" && !done) {
          fail(
            Object.assign(Error(m.message || "Your match has ended."), {
              terminal: handshake.type === "resume",
            }),
          );
          return;
        }
        if (
          m.type === "rubble-spawn" ||
          m.type === "rubble-remove" ||
          m.type === "rubble-poses"
        ) {
          this.rubble.accept(m);
          if (m.type === "rubble-spawn")
            for (const i of m.indices) this.structures.set(i, 2);
        }
        if (m.type === "structure") {
          if (m.state) this.structures.set(m.index, m.state);
          else this.structures.delete(m.index);
        }
        if (m.type === "pong") {
          const rtt = performance.now() - m.time;
          if (rtt >= 0 && rtt < 10000)
            this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
        } else if (m.type === "roster") {
          this.roster = m.actors;
        } else if (m.type === "snapshot") {
          this.wave = m.wave ?? null;
          if (Number.isFinite(m.time))
            this.serverOffset = m.time + this.rtt / 2 - Date.now();
          if (m.actors && m.actors.length !== this.roster.length) return;
          if (m.actors)
            m.players = m.actors.map((a: any[], i: number) => ({
              ...this.roster[i],
              p: a.slice(0, 3),
              yaw: a[3],
              pitch: a[4],
              hp: a[5],
              kills: a[6],
              deaths: a[7],
              weapon: a[8],
              height: a[9],
              anchor: a[10],
              lean: a[11] ?? 0,
              engaged: !!a[12],
              notoriety: a[13],
              action: a[14],
              fall: a[15],
              swing: a[16],
              reaction: a[17],
              skiddingCar: a[18],
            }));
          const now = performance.now();
          for (const p of m.players as RemoteState[]) {
            const old = this.samples.get(p.id),
              serverTime = Number.isFinite(m.time) ? m.time : now,
              dt = old ? (serverTime - old.serverTime) / 1000 : 0;
            const v = (
              old && dt > 0.008 && dt < 0.5
                ? p.p.map((n, i) => (n - old.p[i]) / dt)
                : [0, 0, 0]
            ) as V3;
            const speed = Math.hypot(...v);
            if (speed > 60) v.fill(0);
            this.samples.set(p.id, { p: [...p.p], v, time: now, serverTime });
          }
          const ids = new Set(m.players.map((p: RemoteState) => p.id));
          for (const id of this.samples.keys())
            if (!ids.has(id)) this.samples.delete(id);
          this.players = m.players;
        }
        this.onMessage(m);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!done) {
          done = true;
          reject(Error("Connection closed before joining."));
        }
        if (this.socket !== ws) return;
        this.active = false;
        if (this.pingTimer) clearInterval(this.pingTimer);
        if (this.session && !this.reconnecting && done) {
          this.reconnecting = true;
          this.retryUntil = Date.now() + 90000;
          this.onMessage({ type: "reconnecting" });
          void this.restore().catch(() => {});
        } else if (!this.session) this.onMessage({ type: "disconnected" });
      };
    });
  }
  speed(p: RemoteState) {
    const sample = this.samples.get(p.id);
    if (!sample || performance.now() - sample.time > 200) return 0;
    return Math.hypot(sample.v[0], sample.v[2]);
  }
  position(p: RemoteState): V3 {
    const sample = this.samples.get(p.id);
    if (!sample) return p.p;
    const ahead = Math.min(
      0.065,
      Math.max(0, (performance.now() - sample.time) / 1000),
    );
    return sample.p.map((v, i) => v + sample.v[i] * ahead) as V3;
  }
  send(message: unknown) {
    if (
      this.active &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount < 16384
    ) {
      this.socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }
  disconnect() {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ type: "leave" }));
    this.session = null;
    this.save("dc.session", null);
    this.reconnecting = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.samples.clear();
    this.roster = [];
    this.rtt = 0;
    const old = this.socket;
    this.socket = null;
    this.active = false;
    this.players = [];
    this.wave = null;
    old?.close();
  }
}
