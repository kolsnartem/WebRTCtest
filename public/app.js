document.addEventListener('DOMContentLoaded', () => {
  // DOM елементи
  const registerButton = document.getElementById('registerButton');
  const userId = document.getElementById('userId');
  const registration = document.getElementById('registration');
  const userSelection = document.getElementById('userSelection');
  const userList = document.getElementById('userList');
  const callButton = document.getElementById('callButton');
  const answerButton = document.getElementById('answerButton');
  const endCallButton = document.getElementById('endCallButton');
  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  const statusDisplay = document.getElementById('status');
  const videoToggle = document.getElementById('videoToggle');
  const audioToggle = document.getElementById('audioToggle');
  const hangUpButton = document.getElementById('hangUpButton');
  const callControls = document.getElementById('callControls');
  const videoChat = document.getElementById('videoChat');
  const videoGrid = document.querySelector('.video-grid');
  const audioCall = document.getElementById('audioCall');

  // Змінні
  let localStream;
  let peerConnection;
  let socket;
  let myUserId;
  let selectedUser;
  let incomingCall = false;
  let incomingUserId;
  let pendingOffer = null;
  let isVideoCall = false;

  const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  function updateStatus(message) {
    statusDisplay.textContent = message;
  }

  function toggleCallInterface(videoEnabled) {
    isVideoCall = videoEnabled;
    videoGrid.classList.toggle('hidden', !videoEnabled);
    audioCall.classList.toggle('hidden', videoEnabled);
    if (videoEnabled && localStream) {
      localVideo.srcObject = null;
      localVideo.srcObject = localStream;
    }
  }

  function updateToggleButtons() {
    const audioTrack = localStream?.getAudioTracks()[0];
    const videoTrack = localStream?.getVideoTracks()[0];

    // Оновлення кнопки аудіо
    audioToggle.innerHTML = audioTrack && audioTrack.enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    audioToggle.classList.toggle('off', !audioTrack || !audioTrack.enabled);

    // Оновлення кнопки відео
    videoToggle.innerHTML = videoTrack ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    videoToggle.classList.toggle('off', !videoTrack);
  }

  socket = io();
  socket.on('connect', () => updateStatus('Підключено. Введіть ім\'я.'));

  async function initializeMedia(constraints) {
    try {
      if (localStream) localStream.getTracks().forEach(track => track.stop());
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      // Переконуємося, що аудіотрек увімкнений
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) audioTrack.enabled = true;
      localVideo.srcObject = localStream;
      updateToggleButtons();
      toggleCallInterface(constraints.video);
      updateStatus('Готово до дзвінків');
      return true;
    } catch (error) {
      updateStatus(`Помилка доступу до медіа: ${error.message}`);
      return false;
    }
  }

  async function updateVideoStream(enableVideo) {
    if (!localStream || !peerConnection) return;

    const currentVideoTrack = localStream.getVideoTracks()[0];
    if (enableVideo && !currentVideoTrack) {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const newVideoTrack = videoStream.getVideoTracks()[0];
      localStream.addTrack(newVideoTrack);
      const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      } else {
        peerConnection.addTrack(newVideoTrack, localStream);
      }
      toggleCallInterface(true);
    } else if (!enableVideo && currentVideoTrack) {
      localStream.removeTrack(currentVideoTrack);
      currentVideoTrack.stop();
      const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (sender) peerConnection.removeTrack(sender);
      toggleCallInterface(false);
    }

    localVideo.srcObject = localStream;
    updateToggleButtons();
    const offer = await peerConnection.createOffer({ offerToReceiveVideo: true });
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { target: selectedUser || incomingUserId, source: myUserId, offer });
  }

  registerButton.addEventListener('click', async () => {
    if (!userId.value.trim()) return alert('Введіть ім\'я!');
    myUserId = userId.value.trim();
    if (!await initializeMedia({ audio: true, video: false })) return;
    socket.emit('register', myUserId);
    registration.classList.add('hidden');
    userSelection.classList.remove('hidden');
    setupSocketListeners();
    updateStatus(`Ви: ${myUserId}`);
  });

  function setupSocketListeners() {
    socket.on('update-users', (users) => {
      userList.innerHTML = '';
      const otherUsers = users.filter(user => user !== myUserId);
      if (!otherUsers.length) {
        userList.innerHTML = '<div class="no-users">Немає користувачів</div>';
      } else {
        otherUsers.forEach(user => {
          const userItem = document.createElement('div');
          userItem.classList.add('user-item');
          userItem.textContent = user;
          userItem.addEventListener('click', () => {
            document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
            userItem.classList.add('active');
            selectedUser = user;
            if (!incomingCall) callButton.classList.remove('hidden');
            answerButton.classList.add('hidden');
            endCallButton.classList.add('hidden');
            updateStatus(`Обрано: ${user}`);
          });
          userList.appendChild(userItem);
        });
      }
    });

    socket.on('offer', async (data) => {
      if (peerConnection) {
        if (data.source === selectedUser || data.source === incomingUserId) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
          const videoTrack = localStream.getVideoTracks()[0];
          toggleCallInterface(!!videoTrack);
          updateToggleButtons();
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          socket.emit('answer', { target: data.source, source: myUserId, answer });
        }
        return;
      }
      incomingCall = true;
      incomingUserId = data.source;
      pendingOffer = data.offer;
      updateStatus(`Вхідний дзвінок від ${data.source}`);
      callButton.classList.add('hidden');
      answerButton.classList.remove('hidden');
      endCallButton.classList.remove('hidden');
    });

    socket.on('answer', async (data) => {
      if (!peerConnection) return;
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      updateStatus('Дзвінок підключено');
      updateToggleButtons();
    });

    socket.on('ice-candidate', async (data) => {
      if (!peerConnection) return;
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    });

    socket.on('call-ended', (data) => {
      if (data.source === selectedUser || data.source === incomingUserId) {
        updateStatus(`${data.source} завершив дзвінок`);
        endCall(false);
      }
    });
  }

  async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(iceServers);
    localStream.getTracks().forEach(track => {
      track.enabled = true; // Явно вмикаємо трек
      peerConnection.addTrack(track, localStream);
    });
    
    peerConnection.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
      videoChat.classList.remove('hidden');
      userSelection.classList.add('hidden');
      callControls.classList.remove('hidden');
      toggleCallInterface(isVideoCall);
      updateToggleButtons();
    };
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          target: incomingCall ? incomingUserId : selectedUser,
          source: myUserId,
          candidate: event.candidate
        });
      }
    };
    
    peerConnection.oniceconnectionstatechange = () => {
      if (peerConnection.iceConnectionState === 'connected') {
        updateStatus('Дзвінок активний');
        callButton.classList.add('hidden');
        answerButton.classList.add('hidden');
        endCallButton.classList.add('hidden');
        hangUpButton.classList.remove('hidden');
        updateToggleButtons();
      } else if (peerConnection.iceConnectionState === 'disconnected') {
        endCall();
      }
    };
    return peerConnection;
  }

  callButton.addEventListener('click', async () => {
    if (!selectedUser) return alert('Оберіть користувача!');
    updateStatus(`Дзвінок до ${selectedUser}`);
    await initializeMedia({ audio: true, video: false });
    isVideoCall = false;
    await createPeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { target: selectedUser, source: myUserId, offer });
    callButton.classList.add('hidden');
    endCallButton.classList.remove('hidden');
  });

  answerButton.addEventListener('click', async () => {
    if (!incomingCall || !incomingUserId || !pendingOffer) return;
    updateStatus(`Відповідь ${incomingUserId}`);
    await initializeMedia({ audio: true, video: false });
    isVideoCall = false;
    await createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { target: incomingUserId, source: myUserId, answer });
    answerButton.classList.add('hidden');
    endCallButton.classList.remove('hidden');
    incomingCall = false;
    selectedUser = incomingUserId;
    pendingOffer = null;
  });

  endCallButton.addEventListener('click', () => endCall(true));
  hangUpButton.addEventListener('click', () => endCall(true));
  function endCall(sendSignal = true) {
    if (sendSignal && (selectedUser || incomingUserId)) {
      socket.emit('call-ended', { target: selectedUser || incomingUserId, source: myUserId });
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    remoteVideo.srcObject = null;
    videoChat.classList.add('hidden');
    userSelection.classList.remove('hidden');
    callButton.classList.remove('hidden');
    answerButton.classList.add('hidden');
    endCallButton.classList.add('hidden');
    hangUpButton.classList.add('hidden');
    callControls.classList.add('hidden');
    incomingCall = false;
    incomingUserId = null;
    selectedUser = null;
    pendingOffer = null;
    updateStatus('Дзвінок завершено');
  }

  audioToggle.addEventListener('click', () => {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      updateToggleButtons();
    }
  });

  videoToggle.addEventListener('click', async () => {
    const videoEnabled = localStream.getVideoTracks().length > 0;
    await updateVideoStream(!videoEnabled);
  });
});