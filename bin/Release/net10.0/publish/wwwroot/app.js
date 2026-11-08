(() => {
    const elements = {
        leftVideo: document.getElementById('leftVideo'),
        rightVideo: document.getElementById('rightVideo'),
        leftPlaceholder: document.getElementById('leftPlaceholder'),
        rightPlaceholder: document.getElementById('rightPlaceholder'),
        leftCaptureMessage: document.getElementById('leftCaptureMessage'),
        rightCaptureMessage: document.getElementById('rightCaptureMessage'),
        btnLeftStart: document.getElementById('btnLeftStart'),
        btnLeftStop: document.getElementById('btnLeftStop'),
        btnRightStop: document.getElementById('btnRightStop'),
        btnLeftMute: document.getElementById('btnLeftMute'),
        btnRightMute: document.getElementById('btnRightMute'),
        leftLabel: document.getElementById('leftLabel'),
        rightLabel: document.getElementById('rightLabel'),
        leftIdleLabel: document.getElementById('leftIdleLabel'),
        rightIdleLabel: document.getElementById('rightIdleLabel'),
        btnFullscreen: document.getElementById('btnFullscreen'),
        btnHostSession: document.getElementById('btnHostSession'),
        remoteModal: document.getElementById('remoteModal'),
        btnCloseModal: document.getElementById('btnCloseModal'),
        btnCopyCode: document.getElementById('btnCopyCode'),
        btnCopyInvite: document.getElementById('btnCopyInvite'),
        btnEndSession: document.getElementById('btnEndSession'),
        peerStatus: document.getElementById('peerStatus'),
        peerDot: document.getElementById('peerDot'),
        roomCodeText: document.getElementById('roomCodeText'),
        tabHost: document.getElementById('tabHost'),
        tabJoin: document.getElementById('tabJoin'),
        sectionHost: document.getElementById('sectionHost'),
        sectionJoin: document.getElementById('sectionJoin'),
        hostSessionId: document.getElementById('hostSessionId'),
        joinSessionId: document.getElementById('joinSessionId'),
        joinPassword: document.getElementById('joinPassword'),
        btnStartHost: document.getElementById('btnStartHost'),
        btnConnectJoin: document.getElementById('btnConnectJoin'),
        btnCopyPassword: document.getElementById('btnCopyPassword'),
        sessionMessage: document.getElementById('sessionMessage'),
        appOverlay: document.getElementById('appOverlay'),
        overlaySpinner: document.getElementById('overlaySpinner'),
        overlayErrorIcon: document.getElementById('overlayErrorIcon'),
        overlayTitle: document.getElementById('overlayTitle'),
        overlayMessage: document.getElementById('overlayMessage'),
        overlayTroubleshooting: document.getElementById('overlayTroubleshooting'),
        overlayTroubleshootingList: document.getElementById('overlayTroubleshootingList'),
        overlayTechnical: document.getElementById('overlayTechnical'),
        overlayTechnicalText: document.getElementById('overlayTechnicalText'),
        overlayActions: document.getElementById('overlayActions'),
        btnOverlayRetry: document.getElementById('btnOverlayRetry'),
        btnOverlayBack: document.getElementById('btnOverlayBack')
    };

    let socket = null;
    let peerConnection = null;
    let signalingResolve = null;
    let signalingReject = null;
    let role = '';
    let roomId = '';
    let inviteSecret = '';
    let iceConfiguration = null;
    let localStream = null;
    let remoteStream = null;
    let videoSender = null;
    let audioSender = null;
    let pendingCandidates = [];
    let offerInProgress = false;
    let capturePending = false;
    let trackUpdateQueue = Promise.resolve();
    let lastConnectionAttempt = null;
    let retryInProgress = false;
    let connectionTimeoutId = null;
    let modalReturnFocus = null;

    function showMessage(message, isError = false) {
        elements.sessionMessage.textContent = message;
        elements.sessionMessage.classList.toggle('error', isError);
        elements.sessionMessage.classList.remove('hidden');
    }

    function hideAppOverlay() {
        elements.appOverlay.classList.add('hidden');
    }

    function showLoadingScreen(title, message) {
        elements.overlayTitle.textContent = title;
        elements.overlayMessage.textContent = message;
        elements.overlayTroubleshooting.classList.add('hidden');
        elements.overlayTechnical.classList.add('hidden');
        elements.overlayTechnical.open = false;
        elements.overlaySpinner.classList.remove('hidden');
        elements.overlayErrorIcon.classList.add('hidden');
        elements.overlayActions.classList.add('hidden');
        elements.appOverlay.classList.remove('hidden');
    }

    function getTroubleshootingSteps(message) {
        if (/https|browser does not support screen sharing/i.test(message)) {
            return [
                'Open the deployed app through HTTPS (or localhost while developing); screen sharing and secure WebSockets require a secure context.',
                'Use a current version of Chrome or Edge and avoid embedded previews that block screen capture.',
                'If this browser should support the feature, update it and check that screen-capture permissions are not disabled by policy.'
            ];
        }
        if (/invalid room id or secure invite key|valid room id and secure invite key/i.test(message)) {
            return [
                'Check the room ID and secure invite key with the host; paste the full key without spaces.',
                'Ask the host to confirm the room is still open. Rooms are temporary and close if the server restarts.',
                'Make sure both people are using the same hosted app address.'
            ];
        }
        if (/already in use/i.test(message)) {
            return ['Choose a different room ID, or ask the host using that ID to end their session first.'];
        }
        if (/direct connection|TURN|ICE/i.test(message)) {
            return [
                'Confirm both participants have a stable internet connection and allow the browser to use the network.',
                'Some corporate, school, VPN, or mobile networks block direct WebRTC traffic.',
                'For restrictive networks, configure a TURN relay on the server (TURN_URL and TURN_SHARED_SECRET) and try again.'
            ];
        }
        if (/taking too long|timed out|couldn.t reach|could not reach|websocket|signaling server/i.test(message)) {
            return [
                'Confirm the hosted app is online by opening its /health address.',
                'The server must support secure WebSockets (WSS) on HTTPS sites and forward the /signal path with WebSocket upgrades enabled.',
                'If you manage the reverse proxy, check its WebSocket upgrade and forwarded-host/protocol settings, then retry.'
            ];
        }
        return [
            'Check that the app server is running and that your network connection is available.',
            'If you are hosting behind a reverse proxy, verify HTTPS and WebSocket forwarding for /signal.',
            'Try again. If it keeps failing, share the technical details below with the person managing the server.'
        ];
    }

    function showErrorScreen(message, retryable = true, technicalDetails = '') {
        elements.overlayTitle.textContent = 'We couldn’t connect';
        elements.overlayMessage.textContent = message;
        elements.overlayTroubleshootingList.replaceChildren(
            ...getTroubleshootingSteps(message).map(step => {
                const item = document.createElement('li');
                item.textContent = step;
                return item;
            }));
        elements.overlayTroubleshooting.classList.remove('hidden');
        elements.overlayTechnicalText.textContent = technicalDetails;
        elements.overlayTechnical.classList.toggle('hidden', !technicalDetails);
        elements.overlayTechnical.open = false;
        elements.overlaySpinner.classList.add('hidden');
        elements.overlayErrorIcon.classList.remove('hidden');
        elements.overlayActions.classList.remove('hidden');
        elements.btnOverlayRetry.classList.toggle('hidden', !retryable);
        elements.btnOverlayBack.textContent = elements.peerStatus.classList.contains('hidden')
            ? 'Back to setup'
            : 'Return to session';
        elements.appOverlay.classList.remove('hidden');
    }

    function showCaptureMessage(side, message) {
        const target = side === 'left' ? elements.leftCaptureMessage : elements.rightCaptureMessage;
        target.textContent = message;
        target.classList.remove('hidden');
    }

    function clearCaptureMessage(side) {
        const target = side === 'left' ? elements.leftCaptureMessage : elements.rightCaptureMessage;
        target.textContent = '';
        target.classList.add('hidden');
    }

    function setPeerStatus(label, isConnected) {
        elements.peerStatus.classList.remove('hidden');
        elements.roomCodeText.textContent = label;
        elements.peerDot.classList.toggle('connected', isConnected);
    }

    function updateSessionActions(active) {
        elements.btnHostSession.classList.toggle('hidden', active);
        elements.btnEndSession.textContent = role === 'guest' ? 'Leave Session' : 'End Session';
        elements.btnEndSession.setAttribute('aria-label', role === 'guest' ? 'Leave session' : 'End session');
        document.body.classList.toggle('session-active', active);
        elements.leftPlaceholder.classList.toggle('hidden', !active || !!localStream);
        elements.rightPlaceholder.classList.toggle('hidden', !active || !!elements.rightVideo.srcObject);
        updateIdleMarkers();
    }

    function openSessionModal() {
        modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        elements.sessionMessage.classList.add('hidden');
        elements.remoteModal.classList.remove('hidden');
        requestAnimationFrame(() => {
            const selectedTab = elements.tabHost.getAttribute('aria-selected') === 'true'
                ? elements.hostSessionId
                : elements.joinSessionId;
            selectedTab.focus();
        });
    }

    function closeSessionModal() {
        if (elements.remoteModal.classList.contains('hidden')) return;
        elements.remoteModal.classList.add('hidden');
        const focusTarget = modalReturnFocus?.isConnected && !modalReturnFocus.classList.contains('hidden')
            ? modalReturnFocus
            : elements.btnEndSession;
        modalReturnFocus = null;
        focusTarget.focus();
    }

    function updateRemoteLabels() {
        const remoteRole = role === 'guest' ? 'host' : 'guest';
        elements.rightLabel.textContent = `${remoteRole.toUpperCase()} SCREEN`;
        elements.rightIdleLabel.textContent = `${remoteRole.toUpperCase()} SCREEN`;
        document.getElementById('rightContainer').setAttribute('aria-label', `${remoteRole} screen`);
        updateMuteButton(elements.btnRightMute, elements.rightVideo.muted, false);
    }

    function updateIdleMarkers() {
        const sessionActive = document.body.classList.contains('session-active');
        elements.leftIdleLabel.parentElement.classList.toggle('hidden', sessionActive || !!localStream);
        elements.rightIdleLabel.parentElement.classList.toggle('hidden', sessionActive || !!elements.rightVideo.srcObject);
    }

    function updateMuteButton(button, muted, outgoing) {
        const remoteRole = role === 'guest' ? 'host' : 'guest';
        const label = outgoing
            ? `${muted ? 'Unmute' : 'Mute'} my audio`
            : `${muted ? 'Hear' : 'Mute'} ${remoteRole} audio`;
        button.textContent = label;
        button.setAttribute('aria-pressed', String(muted));
        button.setAttribute('aria-label', label);
        button.title = outgoing ? `${label} (shared system audio)` : `${label} (received system audio)`;
    }

    async function copyText(text) {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return;
            } catch {
                // Continue with the browser-compatible fallback below.
            }
        }

        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        if (!copied) throw new Error('Clipboard access was denied by the browser.');
    }

    function sendSignal(message) {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(message));
        return true;
    }

    function validateBrowserSupport() {
        if (location.protocol !== 'https:' &&
            location.hostname !== 'localhost' &&
            location.hostname !== '127.0.0.1') {
            throw new Error('Open the hosted app over HTTPS to use screen sharing.');
        }
        if (!window.RTCPeerConnection || !navigator.mediaDevices?.getDisplayMedia) {
            throw new Error('This browser does not support screen sharing. Use current Chrome or Edge on the HTTPS site, not the VS Code preview.');
        }
    }

    function clearInviteDisplay() {
        inviteSecret = '';
        elements.btnCopyPassword.disabled = true;
        elements.btnCopyInvite.classList.add('hidden');
    }

    function resetPeerConnection() {
        if (peerConnection) peerConnection.close();
        peerConnection = null;
        remoteStream = null;
        videoSender = null;
        audioSender = null;
        pendingCandidates = [];
        offerInProgress = false;
    }

    function stopRemoteView() {
        elements.rightVideo.srcObject = null;
        updateIdleMarkers();
        elements.rightVideo.muted = true;
        elements.rightPlaceholder.classList.remove('hidden');
        elements.btnRightStop.disabled = true;
        elements.btnRightMute.disabled = true;
        updateRemoteLabels();
        clearCaptureMessage('right');
    }

    function stopLocalCapture(notifyPeer = true) {
        const stream = localStream;
        localStream = null;
        elements.leftVideo.srcObject = null;
        updateIdleMarkers();
        elements.leftPlaceholder.classList.remove('hidden');
        elements.btnLeftStop.disabled = true;
        elements.leftLabel.textContent = 'YOUR SCREEN';
        elements.btnLeftMute.disabled = true;
        updateMuteButton(elements.btnLeftMute, true, true);
        clearCaptureMessage('left');

        if (stream) {
            if (notifyPeer) sendSignal({ type: 'stopped' });
            for (const track of stream.getTracks()) {
                track.onended = null;
                track.stop();
            }
        }
        void replaceLocalTracks().catch(error =>
            showMessage(`Could not stop sending screen and audio tracks: ${error.message}`, true));
    }

    function closeRoomSocket() {
        if (!socket) return;
        const activeSocket = socket;
        socket = null;
        activeSocket.close();
    }

    function endSession() {
        const activeSocket = socket;
        const endedRole = role;
        signalingReject?.(new Error('Session ended.'));
        signalingResolve = null;
        signalingReject = null;
        socket = null;

        stopLocalCapture(false);
        stopRemoteView();
        resetPeerConnection();
        clearInviteDisplay();
        iceConfiguration = null;
        roomId = '';
        role = '';
        lastConnectionAttempt = null;
        updateRemoteLabels();
        updateSessionActions(false);
        elements.peerStatus.classList.add('hidden');
        elements.roomCodeText.textContent = 'Session: Offline';
        elements.btnStartHost.disabled = false;
        elements.btnStartHost.textContent = 'Start Hosting Session';
        elements.btnConnectJoin.disabled = false;
        elements.btnConnectJoin.textContent = 'Connect to Host';
        if (activeSocket && activeSocket.readyState < WebSocket.CLOSING) {
            activeSocket.close(1000, 'Session ended');
        }
        showMessage(endedRole === 'guest' ? 'You left the session.' : 'Session ended.');
    }

    function cleanupDisconnectedRoom(activeSocket) {
        if (socket !== activeSocket) return;
        clearTimeout(connectionTimeoutId);
        connectionTimeoutId = null;
        signalingReject?.(new Error('The room connection was closed.'));
        signalingResolve = null;
        signalingReject = null;
        setPeerStatus('Session: Disconnected', false);
        stopLocalCapture(false);
        stopRemoteView();
        resetPeerConnection();
        clearInviteDisplay();
        elements.btnStartHost.disabled = false;
        elements.btnStartHost.textContent = 'Start Hosting Session';
        elements.btnConnectJoin.disabled = false;
        elements.btnConnectJoin.textContent = 'Connect to Host';
        role = '';
        roomId = '';
        iceConfiguration = null;
        updateRemoteLabels();
        updateSessionActions(false);
        elements.peerStatus.classList.add('hidden');
    }

    function connectToRoom(action, requestedRoom, password) {
        validateBrowserSupport();
        if (action === 'join' && !/^[A-Za-z0-9_-]{43}$/.test(password)) {
            throw new Error('A secure invite key is required. Ask the host for the room password or secure invite link.');
        }

        clearInviteDisplay();
        lastConnectionAttempt = { action, room: requestedRoom, password };
        showLoadingScreen(
            action === 'create' ? 'Creating your session' : 'Joining the session',
            'Securing the connection…');
        if (socket) {
            stopLocalCapture(false);
            stopRemoteView();
            resetPeerConnection();
            closeRoomSocket();
        }
        role = action === 'create' ? 'host' : 'guest';
        roomId = requestedRoom;
        let connectionResolved = false;
        updateRemoteLabels();
        iceConfiguration = null;
        const signalUrl = new URL('signal', new URL('./', document.baseURI));
        signalUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const activeSocket = new WebSocket(signalUrl);
        socket = activeSocket;
        let connectionStage = 'Opening WebSocket connection';
        const getConnectionDetails = () =>
            `Stage: ${connectionStage}\nAction: ${action === 'create' ? 'Create room' : 'Join room'}\nRoom ID: ${roomId}\nWebSocket: ${signalUrl.href}`;

        const connectionPromise = new Promise((resolve, reject) => {
            signalingResolve = resolve;
            signalingReject = reject;
        });
        connectionTimeoutId = setTimeout(() => {
            if (socket !== activeSocket || connectionResolved ||
                activeSocket.readyState >= WebSocket.CLOSING) return;
            connectionResolved = true;
            const error = new Error('The WebSocket connection did not complete within 15 seconds.');
            showErrorScreen(error.message, true, getConnectionDetails());
            signalingReject?.(error);
            activeSocket.close();
        }, 15000);

        activeSocket.addEventListener('open', () => {
            if (socket !== activeSocket || connectionResolved) return;
            clearTimeout(connectionTimeoutId);
            connectionStage = 'Waiting for the server to accept the room request';
            connectionTimeoutId = setTimeout(() => {
                if (socket !== activeSocket || connectionResolved ||
                    activeSocket.readyState >= WebSocket.CLOSING) return;
                connectionResolved = true;
                const error = new Error('The WebSocket opened, but the signaling server did not answer the room request within 15 seconds.');
                showErrorScreen(error.message, true, getConnectionDetails());
                signalingReject?.(error);
                activeSocket.close();
            }, 15000);
            try {
                activeSocket.send(JSON.stringify(action === 'create'
                    ? { type: 'create', room: roomId }
                    : { type: 'join', room: roomId, password }));
            } catch (error) {
                connectionResolved = true;
                clearTimeout(connectionTimeoutId);
                connectionTimeoutId = null;
                showErrorScreen(`Could not send the room request: ${error.message}`, true, getConnectionDetails());
                signalingReject?.(error);
                activeSocket.close();
            }
        }, { once: true });

        activeSocket.addEventListener('message', async event => {
            if (socket !== activeSocket || connectionResolved) return;
            try {
                const message = JSON.parse(event.data);
                if (message?.type === 'created' || message?.type === 'joined' || message?.type === 'error') {
                    connectionResolved = true;
                    clearTimeout(connectionTimeoutId);
                    connectionTimeoutId = null;
                }
                if (message?.type === 'created' || message?.type === 'joined') {
                    connectionStage = 'Room accepted; preparing the WebRTC connection';
                }
                await handleSignalMessage(message, getConnectionDetails());
            } catch (error) {
                connectionResolved = true;
                clearTimeout(connectionTimeoutId);
                connectionTimeoutId = null;
                showErrorScreen(`The session encountered a problem: ${error.message}`, true, getConnectionDetails());
                signalingReject?.(error);
                activeSocket.close(1008, 'Invalid signaling response');
            }
        });

        activeSocket.addEventListener('error', () => {
            if (socket !== activeSocket || connectionResolved) return;
            connectionResolved = true;
            const error = new Error('The browser could not establish or keep open a WebSocket connection to the signaling server.');
            clearTimeout(connectionTimeoutId);
            connectionTimeoutId = null;
            signalingReject?.(error);
            showErrorScreen(
                error.message,
                true,
                `${getConnectionDetails()}\nBrowser detail: Browsers do not expose the underlying WebSocket network error to web pages.`);
            activeSocket.close();
        });

        activeSocket.addEventListener('close', () => cleanupDisconnectedRoom(activeSocket));
        return connectionPromise;
    }

    async function handleSignalMessage(message, technicalDetails = '') {
        if (!message || typeof message !== 'object') {
            throw new Error('The server sent an invalid response.');
        }
        if (message.type === 'error') {
            const error = new Error(message.message || 'The room connection failed.');
            clearTimeout(connectionTimeoutId);
            connectionTimeoutId = null;
            signalingReject?.(error);
            showErrorScreen(error.message, true, technicalDetails || `Stage: Room request rejected by server\nRoom ID: ${roomId}`);
            socket?.close();
            return;
        }

        if (message.type === 'created' || message.type === 'joined') {
            clearTimeout(connectionTimeoutId);
            connectionTimeoutId = null;
            if (typeof message.room !== 'string' || !Array.isArray(message.iceServers)) {
                throw new Error('The server did not return valid room and network settings.');
            }
            if (role === 'host') {
                if (typeof message.key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(message.key)) {
                    throw new Error('The server did not return a valid secure invite key.');
                }
                inviteSecret = message.key;
                elements.btnCopyPassword.disabled = false;
            }

            roomId = message.room;
            iceConfiguration = { iceServers: message.iceServers };
            ensurePeerConnection();
            setPeerStatus(`${role === 'host' ? 'Host' : 'Connected'}: ${roomId}`, true);
            updateSessionActions(true);
            hideAppOverlay();
            elements.btnCopyInvite.classList.toggle('hidden', role !== 'host');
            if (role === 'host') {
                elements.btnStartHost.disabled = true;
                elements.btnStartHost.textContent = 'Room is active';
            }
            if (role === 'guest') {
                elements.remoteModal.classList.add('hidden');
                showMessage('Joined the room. Share your screen to start the two-way stream.');
            } else {
                showMessage('Your private room is ready. Copy the secure key below and share it only with your guest. This dialog will stay open until you close it.');
            }
            signalingResolve?.();
            signalingResolve = null;
            signalingReject = null;
            return;
        }

        if (message.type === 'peer-joined') {
            ensurePeerConnection();
            showMessage('Guest joined. Share your screen to start streaming.');
            if (role === 'host' && localStream) sendSignal({ type: 'ready' });
            return;
        }

        if (message.type === 'peer-left') {
            resetPeerConnection();
            stopRemoteView();
            showMessage('The other participant disconnected.', true);
            return;
        }

        if (message.type === 'ready') {
            if (role === 'guest') await createOffer();
            return;
        }

        if (message.type === 'stopped') {
            stopRemoteView();
            return;
        }

        if (message.type === 'offer') {
            if (!peerConnection || typeof message.sdp !== 'string') {
                throw new Error('Received an invalid WebRTC offer.');
            }
            const connection = peerConnection;
            await connection.setRemoteDescription({ type: 'offer', sdp: message.sdp });
            const videoTransceiver = connection.getTransceivers()
                .find(transceiver => transceiver.receiver.track.kind === 'video');
            const audioTransceiver = connection.getTransceivers()
                .find(transceiver => transceiver.receiver.track.kind === 'audio');
            if (!videoTransceiver || !audioTransceiver) {
                throw new Error('The WebRTC offer did not include the expected video and audio tracks.');
            }
            videoTransceiver.direction = 'sendrecv';
            audioTransceiver.direction = 'sendrecv';
            videoSender = videoTransceiver.sender;
            audioSender = audioTransceiver.sender;
            await replaceLocalTracks();
            await addPendingCandidates();
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            if (!sendSignal({ type: 'answer', sdp: peerConnection.localDescription.sdp })) {
                throw new Error('The room connection closed before the answer was sent.');
            }
            return;
        }

        if (message.type === 'answer' && peerConnection && typeof message.sdp === 'string') {
            await peerConnection.setRemoteDescription({ type: 'answer', sdp: message.sdp });
            await addPendingCandidates();
            return;
        }

        if (message.type === 'ice' && peerConnection && message.candidate) {
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(message.candidate);
            } else {
                pendingCandidates.push(message.candidate);
            }
        }
    }

    function ensurePeerConnection() {
        if (peerConnection && peerConnection.signalingState !== 'closed') return;
        if (!iceConfiguration) throw new Error('Missing ICE server settings for this room.');

        const connection = new RTCPeerConnection(iceConfiguration);
        peerConnection = connection;
        remoteStream = new MediaStream();
        if (role === 'guest') {
            videoSender = connection.addTransceiver('video', { direction: 'sendrecv' }).sender;
            audioSender = connection.addTransceiver('audio', { direction: 'sendrecv' }).sender;
        } else {
            videoSender = null;
            audioSender = null;
        }
        pendingCandidates = [];

        connection.addEventListener('icecandidate', event => {
            if (peerConnection === connection && event.candidate) {
                sendSignal({ type: 'ice', candidate: event.candidate.toJSON() });
            }
        });

        connection.addEventListener('track', event => {
            if (peerConnection !== connection) return;
            if (!remoteStream.getTracks().includes(event.track)) remoteStream.addTrack(event.track);
            if (event.track.kind === 'video' && event.track.readyState === 'live') {
                attachRemoteStream(remoteStream);
            }
            if (event.track.kind === 'audio') {
                elements.btnRightMute.disabled = event.track.readyState !== 'live';
            }
            event.track.addEventListener('ended', () => {
                if (peerConnection !== connection) return;
                if (event.track.kind === 'audio' &&
                    !remoteStream.getAudioTracks().some(track => track.readyState === 'live')) {
                    elements.rightVideo.muted = true;
                    elements.btnRightMute.disabled = true;
                    updateMuteButton(elements.btnRightMute, true, false);
                }
                if (!remoteStream.getVideoTracks().some(track => track.readyState === 'live')) {
                    stopRemoteView();
                }
            }, { once: true });
        });

        connection.addEventListener('connectionstatechange', () => {
            if (peerConnection !== connection) return;
            if (connection.connectionState === 'connected') {
                showMessage('Screen and system-audio stream connected.');
            } else if (connection.connectionState === 'failed') {
                showErrorScreen(
                    'The room was created, but a direct WebRTC media connection could not be established.',
                    false,
                    `Stage: WebRTC media connection\nICE connection state: ${connection.iceConnectionState}\nPeer connection state: ${connection.connectionState}`);
            }
        });

        void replaceLocalTracks().catch(error =>
            showMessage(`Could not prepare screen and audio tracks: ${error.message}`, true));
    }

    function replaceLocalTracks() {
        if (!peerConnection || !videoSender || !audioSender) return Promise.resolve();
        const connection = peerConnection;
        const stream = localStream;
        const videoTrack = stream?.getVideoTracks()[0] || null;
        const audioTrack = stream?.getAudioTracks()[0] || null;
        const update = async () => {
            if (peerConnection !== connection) return;
            await Promise.all([
                videoSender.replaceTrack(videoTrack),
                audioSender.replaceTrack(audioTrack)
            ]);
        };
        trackUpdateQueue = trackUpdateQueue.then(update, update);
        return trackUpdateQueue;
    }

    async function createOffer() {
        if (role !== 'guest' || !peerConnection ||
            peerConnection.signalingState !== 'stable' || offerInProgress) return;
        offerInProgress = true;
        try {
            await replaceLocalTracks();
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            if (!sendSignal({ type: 'offer', sdp: peerConnection.localDescription.sdp })) {
                throw new Error('The room connection closed before the offer was sent.');
            }
        } catch (error) {
            showMessage(`Could not start the screen connection: ${error.message}`, true);
        } finally {
            offerInProgress = false;
        }
    }

    async function addPendingCandidates() {
        const candidates = pendingCandidates;
        pendingCandidates = [];
        for (const candidate of candidates) {
            await peerConnection.addIceCandidate(candidate);
        }
    }

    function attachRemoteStream(stream) {
        elements.rightVideo.srcObject = stream;
        updateIdleMarkers();
        elements.rightVideo.muted = true;
        elements.rightPlaceholder.classList.add('hidden');
        elements.btnRightStop.disabled = false;
        elements.btnRightMute.disabled = !stream.getAudioTracks().some(track => track.readyState === 'live');
        updateRemoteLabels();
        updateMuteButton(elements.btnRightMute, true, false);
        clearCaptureMessage('right');
        elements.rightVideo.play().catch(error => {
            if (error.name !== 'AbortError' && elements.rightVideo.srcObject === stream) {
                showCaptureMessage('right', `Video playback failed: ${error.message}`);
            }
        });
    }

    async function attachLocalStream(stream) {
        localStream = stream;
        elements.leftVideo.srcObject = stream;
        updateIdleMarkers();
        elements.leftVideo.muted = true;
        elements.leftPlaceholder.classList.add('hidden');
        elements.btnLeftStop.disabled = false;
        elements.leftLabel.textContent = 'YOUR SCREEN';
        clearCaptureMessage('left');
        elements.leftVideo.play().catch(error => {
            if (error.name !== 'AbortError' && elements.leftVideo.srcObject === stream) {
                showCaptureMessage('left', `Video playback failed: ${error.message}`);
            }
        });

        const audioTracks = stream.getAudioTracks();
        elements.btnLeftMute.disabled = audioTracks.length === 0;
        updateMuteButton(elements.btnLeftMute, audioTracks.length === 0 || !audioTracks[0].enabled, true);
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) videoTrack.onended = () => stopLocalCapture();
        await replaceLocalTracks();

        if (!audioTracks.length) {
            showCaptureMessage('left', 'Screen is shared, but this source provides no system audio. Choose a full screen and enable “Share system audio” if offered. Microphone audio is never used.');
        }
        sendSignal({ type: 'ready' });
        if (role === 'guest') void createOffer();
    }

    async function startCapture() {
        clearCaptureMessage('left');
        if (capturePending) return;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            showCaptureMessage('left', 'Host or join a room before sharing your screen.');
            return;
        }
        if (!navigator.mediaDevices?.getDisplayMedia) {
            showCaptureMessage('left', 'Screen sharing is unavailable in this browser. Open the public HTTPS site in current Chrome or Edge.');
            return;
        }

        const captureSocket = socket;
        capturePending = true;
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: 30 },
                audio: true
            });
            if (!stream.getVideoTracks().length) {
                stream.getTracks().forEach(track => track.stop());
                throw new Error('No screen video source was selected.');
            }
            if (socket !== captureSocket || captureSocket.readyState !== WebSocket.OPEN) {
                stream.getTracks().forEach(track => track.stop());
                showCaptureMessage('left', 'The room disconnected before screen sharing started. Reconnect and try again.');
                return;
            }
            await attachLocalStream(stream);
        } catch (error) {
            if (error.name === 'AbortError' || error.name === 'NotAllowedError') {
                showCaptureMessage('left', 'Screen sharing was cancelled or blocked. Allow sharing and choose a screen/window in the browser prompt.');
            } else if (error.name === 'NotSupportedError') {
                showCaptureMessage('left', 'This browser reports screen capture as unsupported. Open the hosted HTTPS app in Chrome or Edge, not the VS Code preview.');
            } else {
                showCaptureMessage('left', `Could not share the screen: ${error.message || error.name}`);
            }
        } finally {
            capturePending = false;
        }
    }

    function selectSessionTab(tab) {
        const hostSelected = tab === 'host';
        elements.tabHost.setAttribute('aria-selected', String(hostSelected));
        elements.tabJoin.setAttribute('aria-selected', String(!hostSelected));
        elements.sectionHost.classList.toggle('hidden', !hostSelected);
        elements.sectionJoin.classList.toggle('hidden', hostSelected);
        elements.sectionHost.hidden = !hostSelected;
        elements.sectionJoin.hidden = hostSelected;
        elements.sessionMessage.classList.add('hidden');
    }

    elements.tabHost.addEventListener('click', () => selectSessionTab('host'));
    elements.tabJoin.addEventListener('click', () => selectSessionTab('join'));
    elements.btnHostSession.addEventListener('click', openSessionModal);
    elements.btnCloseModal.addEventListener('click', closeSessionModal);
    elements.remoteModal.addEventListener('click', event => {
        if (event.target === elements.remoteModal) closeSessionModal();
    });
    elements.remoteModal.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSessionModal();
            return;
        }
        if (event.key !== 'Tab') return;

        const focusable = [...elements.remoteModal.querySelectorAll(
            'button:not(:disabled):not(.hidden), input:not(:disabled):not([hidden]), [tabindex]:not([tabindex="-1"])'
        )].filter(element => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
    elements.btnEndSession.addEventListener('click', endSession);
    elements.btnOverlayBack.addEventListener('click', () => {
        hideAppOverlay();
        if (!role) openSessionModal();
    });
    elements.btnOverlayRetry.addEventListener('click', async () => {
        if (retryInProgress || !lastConnectionAttempt) return;
        retryInProgress = true;
        const attempt = lastConnectionAttempt;
        elements.btnOverlayRetry.disabled = true;
        showLoadingScreen('Trying again', 'Reconnecting to your session…');
        const oldSocket = socket;
        socket = null;
        if (oldSocket && oldSocket.readyState < WebSocket.CLOSING) {
            await new Promise(resolve => {
                oldSocket.addEventListener('close', resolve, { once: true });
                oldSocket.close();
                if (oldSocket.readyState === WebSocket.CLOSED) resolve();
            });
        }
        resetPeerConnection();
        try {
            await new Promise(resolve => setTimeout(resolve, 300));
            await connectToRoom(attempt.action, attempt.room, attempt.password);
        } catch (error) {
            showErrorScreen(error.message);
        } finally {
            retryInProgress = false;
            elements.btnOverlayRetry.disabled = false;
        }
    });
    elements.btnLeftStart.addEventListener('click', startCapture);
    elements.btnLeftStop.addEventListener('click', () => stopLocalCapture());
    elements.btnRightStop.addEventListener('click', stopRemoteView);

    elements.btnLeftMute.addEventListener('click', () => {
        const audioTracks = localStream?.getAudioTracks() || [];
        if (!audioTracks.length) {
            showCaptureMessage('left', 'No system audio track is available to mute or unmute.');
            return;
        }
        const enabled = !audioTracks[0].enabled;
        for (const track of audioTracks) track.enabled = enabled;
        updateMuteButton(elements.btnLeftMute, !enabled, true);
    });

    elements.btnRightMute.addEventListener('click', async () => {
        if (!elements.rightVideo.srcObject) return;
        elements.rightVideo.muted = !elements.rightVideo.muted;
        updateMuteButton(elements.btnRightMute, elements.rightVideo.muted, false);
        if (!elements.rightVideo.muted) {
            try {
                await elements.rightVideo.play();
            } catch (error) {
                elements.rightVideo.muted = true;
                updateMuteButton(elements.btnRightMute, true, false);
                showMessage(`Could not play received system audio: ${error.message}`, true);
            }
        }
    });

    elements.btnStartHost.addEventListener('click', async () => {
        if (elements.btnStartHost.disabled) return;
        const enteredRoom = elements.hostSessionId.value.trim();
        const requestedRoom = (enteredRoom || `session-${crypto.randomUUID().slice(0, 8)}`).toLowerCase();
        if (!/^[a-z0-9_-]{3,48}$/.test(requestedRoom)) {
            showMessage('Room IDs must be 3–48 characters: letters, numbers, hyphens, or underscores.', true);
            return;
        }
        elements.btnStartHost.disabled = true;
        elements.btnStartHost.textContent = 'Creating secure room…';
        try {
            await connectToRoom('create', requestedRoom, '');
        } catch (error) {
            showErrorScreen(error.message, true, `Stage: Browser check or room setup\nAction: Create room\nRoom ID: ${requestedRoom}`);
        } finally {
            if (!inviteSecret) {
                elements.btnStartHost.disabled = false;
                elements.btnStartHost.textContent = 'Start Hosting Session';
            }
        }
    });

    elements.btnConnectJoin.addEventListener('click', async () => {
        if (elements.btnConnectJoin.disabled) return;
        const requestedRoom = elements.joinSessionId.value.trim().toLowerCase();
        if (!/^[a-z0-9_-]{3,48}$/.test(requestedRoom)) {
            showMessage('Enter a room ID using 3–48 letters, numbers, hyphens, or underscores.', true);
            return;
        }
        elements.btnConnectJoin.disabled = true;
        elements.btnConnectJoin.textContent = 'Connecting…';
        try {
            await connectToRoom('join', requestedRoom, elements.joinPassword.value.trim());
        } catch (error) {
            showErrorScreen(error.message, true, `Stage: Browser check or room setup\nAction: Join room\nRoom ID: ${requestedRoom}`);
        } finally {
            if (role !== 'guest') {
                elements.btnConnectJoin.disabled = false;
                elements.btnConnectJoin.textContent = 'Connect to Host';
            }
        }
    });

    elements.btnCopyPassword.addEventListener('click', async () => {
        if (role !== 'host' || !inviteSecret) return;
        try {
            await copyText(inviteSecret);
            showMessage('Secure key copied. Share it privately with your guest.');
        } catch (error) {
            showMessage(`Could not copy the room password: ${error.message}`, true);
        }
    });

    elements.btnCopyCode.addEventListener('click', async () => {
        if (!roomId) return;
        try {
            await copyText(roomId);
            showMessage('Room ID copied.');
        } catch (error) {
            showMessage(`Could not copy the room ID: ${error.message}`, true);
        }
    });

    elements.btnCopyInvite.addEventListener('click', async () => {
        if (role !== 'host' || !roomId || !inviteSecret) return;
        const inviteUrl = new URL(location.href);
        inviteUrl.hash = new URLSearchParams({ join: roomId, key: inviteSecret }).toString();
        try {
            await copyText(inviteUrl.href);
            showMessage('Secure guest invite copied. Send it only to your intended guest.');
        } catch (error) {
            showMessage(`Could not copy the invite link: ${error.message}`, true);
        }
    });

    elements.btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(error => showMessage(error.message, true));
        } else {
            document.exitFullscreen().catch(error => showMessage(error.message, true));
        }
    });

    const invite = new URLSearchParams(location.hash.slice(1));
    const invitedRoom = invite.get('join');
    const invitedKey = invite.get('key');
    if (invitedRoom && invitedKey) {
        elements.joinSessionId.value = invitedRoom;
        elements.joinPassword.value = invitedKey;
        selectSessionTab('join');
        openSessionModal();
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        showMessage('Secure invite loaded. Connect to join the host’s room.');
    }
    hideAppOverlay();
})();
