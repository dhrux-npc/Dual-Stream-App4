# Dual Stream

Dual Stream is an ASP.NET Core 10 LTS web app for one host and one guest. Each person shares their own screen from the left pane; the other person's screen and captured system audio appear in the right pane. It does not request or transmit microphone or camera audio/video.

## Run locally

Install the .NET 10 SDK, then run:

```powershell
dotnet run --urls http://localhost:5080
```

Open the printed local URL in current Microsoft Edge or Google Chrome. Do not use the VS Code integrated browser or open an HTML file directly; those environments may expose screen-capture APIs but reject capture as unsupported.

## Build from source

The main build steps are:

1. **Serve the app over a secure context.** Use `localhost` for development and HTTPS for a public deployment. Browsers require this for screen capture and secure WebSockets.
2. **Create and join a room through the signaling server.** The ASP.NET Core app serves the UI and `/signal` WebSocket endpoint. The host receives a cryptographically generated invite key; the guest must present it to join.
3. **Negotiate the media connection.** After room authentication, the clients exchange WebRTC offers, answers, and ICE candidates over the signaling WebSocket. Screen and optional system-audio media then travel peer-to-peer, not through the app server.
4. **Capture screen and optional system audio.** Each participant explicitly starts screen sharing and chooses a source in the browser picker. The app does not request camera or microphone access.
5. **Configure deployment networking.** For public hosting, terminate TLS, forward WebSocket upgrades for `/signal`, configure `PUBLIC_ORIGIN` and trusted proxy IPs as needed, and configure TURN for networks that block direct WebRTC traffic.

Build and publish with the .NET 10 SDK:

```powershell
dotnet restore
dotnet build -c Release --no-restore
dotnet publish -c Release --no-restore
```

The publish output is written to `bin/Release/net10.0/publish/`. For a container deployment, see the Docker steps below.

## Host publicly

Build and run the included container image:

```powershell
docker build -t dual-stream .
docker run --rm -p 8080:8080 `
  -e TURN_URL="turn:turn.example.com:3478?transport=udp" `
  -e PUBLIC_ORIGIN="https://stream.example.com" `
  -e TRUSTED_PROXY_IPS="172.18.0.1" `
  -e TURN_SHARED_SECRET="your-coturn-static-auth-secret" `
  dual-stream
```

`PUBLIC_ORIGIN` must be the exact public HTTPS origin (scheme and host, with a non-default port if used). Set it when TLS terminates at a reverse proxy so signaling origin checks use the public origin. If it is omitted, the proxy must forward the original `Host` and protocol in `X-Forwarded-Host` and `X-Forwarded-Proto`, and its IP must be listed in `TRUSTED_PROXY_IPS`. The signaling URL is relative to the app's public base path, so a proxy mounting the app under a path must forward that path's `/signal` WebSocket request to the app's `/signal` endpoint. For public access, point a domain at a cloud container host or reverse proxy and enable HTTPS plus WebSocket forwarding to port 8080. Screen sharing is only enabled on HTTPS (or localhost). The container runs as a non-root user.

On Railway, the app uses `RAILWAY_PUBLIC_DOMAIN` as its HTTPS public origin when `PUBLIC_ORIGIN` is not set. Set `PUBLIC_ORIGIN` explicitly when using a custom domain.

Set `TRUSTED_PROXY_IPS` to the actual reverse-proxy IP address(es) when hosted behind a proxy. Forwarded client IP/protocol headers are trusted only from these configured proxies; this keeps IP-based rate limits meaningful without trusting spoofable client headers.

The app serves the UI, room authentication, and WebRTC signaling; screen/audio media travels directly between the two browsers.

For peers behind restrictive NATs or firewalls, configure coturn with its REST/shared-secret authentication mode and set:

- `TURN_URL` — TURN URL, or comma-separated URLs (for example `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp`)
- `TURN_SHARED_SECRET` — coturn `static-auth-secret` value

After a client successfully creates or joins a room, the authenticated WebSocket acknowledgement includes its ICE server configuration and, when TURN is configured, one-hour HMAC-signed credentials. There is no public ICE-configuration endpoint. The app never discloses the long-lived shared secret to browsers. It refuses to start if TURN URLs are configured without a 32-character shared secret or use an invalid URL scheme. Keep the TURN shared secret in the hosting provider's secret settings, never in source control. TURN availability and capacity depend on the service you provision. Without TURN, some networks may not permit a direct WebRTC connection.

Rooms and signaling state are held in memory. Run a single app instance, or use session affinity and shared signaling infrastructure before scaling to multiple instances. Only the host and one guest can occupy a room at a time.

## Connect

1. The host chooses **Host / Join Session**, sets a room ID, and starts hosting. The server creates a cryptographically random 256-bit invite key and stores only its hash.
2. The host uses the link icon in the header to copy the secure invite URL and sends it privately to one trusted guest. Treat this URL like a password; anyone holding it can join while the room is open.
3. Both people open the same HTTPS URL and join the same session. Sharing controls appear only after joining. The host and guest can each select **Start sharing my screen** and choose a screen/window. Enable system audio in the browser's share picker when offered. Either person can select **Stop sharing** at any time. Each person can independently mute their own shared audio or mute playback of the other participant's audio. The host can **End Session**; the guest can **Leave Session**.

Screen audio availability depends on the browser and selected source. The app never asks for a microphone; if the browser does not provide a system-audio track, the screen remains visible and the app reports that audio is unavailable.

Signaling sockets must originate from the configured public origin, invite keys are server-generated and compared using fixed-time hashes, signaling sockets are rate-limited per client IP, and each room relays signaling only between its host and its single guest. ICE server configuration is sent only after successful room authentication. Room state is in memory; closing the host session invalidates its invite key. Use a single app instance; multiple instances need shared room state and coordinated signaling.

## Before public launch

- Configure the hosting provider with `PUBLIC_ORIGIN` and keep `TURN_SHARED_SECRET` in its secret manager.
- Configure `TRUSTED_PROXY_IPS` from the hosting provider's documented proxy addresses if it sits behind a reverse proxy.
- Build and deploy the app/container; a static-file host cannot run the C# room/signaling server or WebSocket endpoint.
- Use a managed host/reverse proxy with TLS and WebSocket support; do not expose plain HTTP publicly.
- Configure and test coturn if users may connect from restrictive networks.
- Confirm resource, bandwidth, and TURN usage limits with your provider. This app limits signaling sockets but does not replace provider-level DDoS protection.
- Test from two real devices on separate networks and verify screen audio in the browser's share picker.
