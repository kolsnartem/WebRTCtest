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
  let callActive = false;

  const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  function updateStatus(message) {
    statusDisplay.textContent = message;
  }

  function toggleCallInterface(videoEnabled) {
    isVideoCall = videoEnabled;
    videoGrid.classList.toggle('hidden', !videoEnabled);
    audioCall.classList.toggle('hidden', videoEnabled);
    
    // Виправлений код - переконуємося, що відео показується коректно
    if (videoEnabled && localStream) {
      // Оновлюємо srcObject тільки якщо у нас є відеотрек
      if (localStream.getVideoTracks().length > 0) {
        localVideo.srcObject = null;
        localVideo.srcObject = localStream;
      }
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

  // Запитуємо доступ до аудіо та відео одночасно
  async function requestPermissions() {
    try {
      // Запитуємо дозвіл для обох медіапотоків одразу
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      
      // Зупиняємо потік, щоб не використовувати ресурси зарання
      tempStream.getTracks().forEach(track => track.stop());
      return true;
    } catch (error) {
      console.error("Помилка отримання дозволів:", error);
      return false;
    }
  }

  async function initializeMedia(constraints) {
    try {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      
      // Створюємо новий потік з запитаними обмеженнями
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Переконуємося, що аудіотрек увімкнений
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = true;
      }
      
      // Встановлюємо локальний відеопотік
      if (localVideo && constraints.video) {
        localVideo.srcObject = localStream;
      }
      
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
    if (!localStream) return;

    const currentVideoTrack = localStream.getVideoTracks()[0];
    
    if (enableVideo && !currentVideoTrack) {
      try {
        // Отримуємо доступ до відео
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newVideoTrack = videoStream.getVideoTracks()[0];
        
        // Додаємо відеотрек до існуючого потоку
        localStream.addTrack(newVideoTrack);
        
        // Показуємо локальне відео
        localVideo.srcObject = localStream;
        
        if (peerConnection) {
          // Знаходимо існуючий відеовідправник або створюємо новий
          const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(newVideoTrack);
          } else {
            peerConnection.addTrack(newVideoTrack, localStream);
          }
          
          // Створюємо нову пропозицію
          const offer = await peerConnection.createOffer({ offerToReceiveVideo: true });
          await peerConnection.setLocalDescription(offer);
          socket.emit('offer', { target: selectedUser || incomingUserId, source: myUserId, offer });
        }
        
        toggleCallInterface(true);
      } catch (error) {
        updateStatus(`Помилка увімкнення відео: ${error.message}`);
        return;
      }
    } else if (!enableVideo && currentVideoTrack) {
      // Видаляємо відеотрек
      localStream.removeTrack(currentVideoTrack);
      currentVideoTrack.stop();
      
      if (peerConnection) {
        const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
        if (sender) peerConnection.removeTrack(sender);
        
        // Створюємо нову пропозицію
        const offer = await peerConnection.createOffer({ offerToReceiveVideo: true });
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { target: selectedUser || incomingUserId, source: myUserId, offer });
      }
      
      toggleCallInterface(false);
    }

    // Завжди оновлюємо відео елемент
    localVideo.srcObject = localStream;
    updateToggleButtons();
  }

  registerButton.addEventListener('click', async () => {
    if (!userId.value.trim()) return alert('Введіть ім\'я!');
    myUserId = userId.value.trim();
    
    // Спочатку запитуємо дозволи на аудіо та відео одночасно
    await requestPermissions();
    
    // Потім ініціалізуємо потік тільки з аудіо для реєстрації
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
            if (!incomingCall && !callActive) callButton.classList.remove('hidden');
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
          const videoTrack = localStream?.getVideoTracks()[0];
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
      callActive = true;
      updateToggleButtons();
    });

    socket.on('ice-candidate', async (data) => {
      if (!peerConnection) return;
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (error) {
        console.error("Помилка додавання ICE-кандидата:", error);
      }
    });

    socket.on('call-ended', (data) => {
      if (data.source === selectedUser || data.source === incomingUserId) {
        updateStatus(`${data.source} завершив дзвінок`);
        endCall(false);
      }
    });
    
    // Перевіряємо статус співрозмовника
    socket.on('disconnect', () => {
      if (callActive) {
        endCall(false);
        updateStatus('З\'єднання втрачено');
      }
    });
  }

  async function createPeerConnection() {
    if (peerConnection) {
      peerConnection.close();
    }
    
    peerConnection = new RTCPeerConnection(iceServers);
    
    if (localStream) {
      localStream.getTracks().forEach(track => {
        track.enabled = true; // Явно вмикаємо трек
        peerConnection.addTrack(track, localStream);
      });
    }
    
    peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
        videoChat.classList.remove('hidden');
        userSelection.classList.add('hidden');
        callControls.classList.remove('hidden');
        toggleCallInterface(isVideoCall);
        callActive = true;
        updateToggleButtons();
      }
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
        callActive = true;
        updateToggleButtons();
      } else if (peerConnection.iceConnectionState === 'disconnected' || 
                 peerConnection.iceConnectionState === 'failed' ||
                 peerConnection.iceConnectionState === 'closed') {
        endCall(true);
      }
    };
    
    // Відстежуємо стан сигнального каналу
    peerConnection.onsignalingstatechange = () => {
      if (peerConnection.signalingState === 'closed') {
        endCall(true);
      }
    };
    
    return peerConnection;
  }

  callButton.addEventListener('click', async () => {
    if (!selectedUser) return alert('Оберіть користувача!');
    updateStatus(`Дзвінок до ${selectedUser}`);
    
    // Запитуємо доступ одразу до обох потоків, але використовуємо тільки аудіо для початку
    await requestPermissions();
    await initializeMedia({ audio: true, video: false });
    
    isVideoCall = false;
    await createPeerConnection();
    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { target: selectedUser, source: myUserId, offer });
    callButton.classList.add('hidden');
    endCallButton.classList.remove('hidden');
  });

  answerButton.addEventListener('click', async () => {
    if (!incomingCall || !incomingUserId || !pendingOffer) return;
    updateStatus(`Відповідь ${incomingUserId}`);
    
    // Запитуємо доступ одразу до обох потоків, але використовуємо тільки аудіо для початку
    await requestPermissions();
    await initializeMedia({ audio: true, video: false });
    
    isVideoCall = false;
    await createPeerConnection();
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('answer', { target: incomingUserId, source: myUserId, answer });
      answerButton.classList.add('hidden');
      endCallButton.classList.remove('hidden');
      incomingCall = false;
      selectedUser = incomingUserId;
      pendingOffer = null;
      callActive = true;
    } catch (error) {
      updateStatus(`Помилка відповіді: ${error.message}`);
      endCall(false);
    }
  });

  endCallButton.addEventListener('click', () => endCall(true));
  hangUpButton.addEventListener('click', () => endCall(true));
  
  function endCall(sendSignal = true) {
    if (sendSignal && (selectedUser || incomingUserId)) {
      socket.emit('call-ended', { target: selectedUser || incomingUserId, source: myUserId });
    }
    
    if (peerConnection) {
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.oniceconnectionstatechange = null;
      peerConnection.onsignalingstatechange = null;
      
      // Зупинка всіх відправників
      peerConnection.getSenders().forEach(sender => {
        if (sender.track) {
          sender.track.enabled = false;
        }
      });
      
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
    pendingOffer = null;
    callActive = false;
    
    // Оновлюємо інтерфейс, якщо користувач все ще вибраний
    if (selectedUser) {
      const userItems = document.querySelectorAll('.user-item');
      userItems.forEach(item => {
        if (item.textContent === selectedUser) {
          item.classList.add('active');
          callButton.classList.remove('hidden');
        }
      });
    } else {
      document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
    }
    
    updateStatus('Дзвінок завершено');
  }

  audioToggle.addEventListener('click', () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      updateToggleButtons();
    }
  });

  videoToggle.addEventListener('click', async () => {
    if (!localStream) return;
    const videoEnabled = localStream.getVideoTracks().length > 0;
    await updateVideoStream(!videoEnabled);
  });
  
  // Обробка перед закриттям вікна/сторінки
  window.addEventListener('beforeunload', () => {
    if (callActive) endCall(true);
  });
});