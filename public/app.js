// Файл: public/app.js
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM завантажено, ініціалізація WebRTC...');
    
    // Елементи DOM
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
  
    // Змінні WebRTC
    let localStream;
    let remoteStream;
    let peerConnection;
    let socket;
    let myUserId;
    let selectedUser;
    let incomingCall = false;
    let incomingUserId;
  
    // Налаштування
    const iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    };
  
    // Функція оновлення статусу
    function updateStatus(message) {
      console.log('Статус:', message);
      statusDisplay.textContent = message;
    }
  
    // Перевірка доступності Socket.io
    if (typeof io === 'undefined') {
      console.error('Socket.io не завантажено!');
      updateStatus('Помилка: Socket.io не завантажено. Перезавантажте сторінку.');
      return;
    }
  
    // Ініціалізація Socket.io
    try {
      socket = io();
      console.log('Socket.io підключено');
    } catch (error) {
      console.error('Помилка підключення Socket.io:', error);
      updateStatus('Помилка підключення до сервера');
      return;
    }
    
    // Перевірка підключення до сервера
    socket.on('connect', () => {
      console.log('Підключено до сервера Socket.io, ID:', socket.id);
      updateStatus('Підключено до сервера. Введіть ім\'я та зареєструйтесь.');
    });
    
    socket.on('connect_error', (error) => {
      console.error('Помилка підключення до сервера:', error);
      updateStatus('Помилка підключення до сервера. Перевірте мережу.');
    });
  
    // Початкова конфігурація медіапотоків
    async function initializeMedia() {
      try {
        console.log('Запит на доступ до медіа пристроїв...');
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
        localVideo.srcObject = localStream;
        console.log('Доступ до медіа надано');
        updateStatus('Готово до дзвінків');
        return true;
      } catch (error) {
        console.error('Помилка доступу до медіа:', error);
        updateStatus(`Помилка доступу до камери/мікрофона: ${error.message}`);
        return false;
      }
    }
  
    // Реєстрація користувача
    registerButton.addEventListener('click', async () => {
      console.log('Кнопка реєстрації натиснута');
      
      if (userId.value.trim() === '') {
        alert('Будь ласка, введіть ім\'я!');
        return;
      }
  
      myUserId = userId.value.trim();
      console.log('Реєстрація користувача:', myUserId);
      
      updateStatus(`Реєстрація як: ${myUserId}...`);
      
      // Спочатку запитуємо доступ до медіа
      const mediaInitialized = await initializeMedia();
      if (!mediaInitialized) {
        return;
      }
      
      // Реєструємо користувача
      socket.emit('register', myUserId);
      
      // Оновлюємо інтерфейс
      registration.classList.add('hidden');
      userSelection.classList.remove('hidden');
      
      // Налаштовуємо слухачі подій
      setupSocketListeners();
      
      updateStatus(`Ви зареєстровані як: ${myUserId}`);
    });
  
    // Налаштування слухачів подій Socket.io
    function setupSocketListeners() {
      console.log('Налаштування слухачів подій Socket.io');
      
      // Оновлення списку користувачів
      socket.on('update-users', (users) => {
        console.log('Отримано оновлений список користувачів:', users);
        userList.innerHTML = '';
        
        let otherUsersCount = 0;
        
        users.forEach(user => {
          if (user !== myUserId) {
            otherUsersCount++;
            const userItem = document.createElement('div');
            userItem.classList.add('user-item');
            userItem.textContent = user;
            userItem.addEventListener('click', () => {
              selectedUser = user;
              callButton.classList.remove('hidden');
              updateStatus(`Обрано користувача: ${user}`);
            });
            userList.appendChild(userItem);
          }
        });
        
        if (otherUsersCount === 0) {
          const noUsers = document.createElement('div');
          noUsers.textContent = 'Немає інших користувачів онлайн';
          userList.appendChild(noUsers);
        }
      });
  
      // Обробка вхідного дзвінка
      socket.on('offer', async (data) => {
        console.log('Отримано пропозицію дзвінка від:', data.source);
        
        if (peerConnection) {
          console.log('Вже в дзвінку, ігнорую пропозицію');
          return;
        }
  
        incomingCall = true;
        incomingUserId = data.source;
        updateStatus(`Вхідний дзвінок від ${data.source}`);
        
        answerButton.classList.remove('hidden');
        callButton.classList.add('hidden');
        
        // Створення RTCPeerConnection і зберігання пропозиції
        await createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      });
  
      // Обробка відповіді
      socket.on('answer', async (data) => {
        console.log('Отримано відповідь від:', data.source);
        
        if (!peerConnection) {
          console.error('Немає активного підключення!');
          return;
        }
        
        updateStatus(`Отримано відповідь від ${data.source}`);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      });
  
      // Обробка ICE кандидатів
      socket.on('ice-candidate', async (data) => {
        console.log('Отримано ICE кандидата від:', data.source);
        
        if (!peerConnection) {
          console.error('Немає активного підключення!');
          return;
        }
        
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (error) {
          console.error('Помилка додавання ICE кандидата:', error);
        }
      });
    }
  
    // Створення WebRTC підключення
    async function createPeerConnection() {
      try {
        console.log('Створення RTCPeerConnection...');
        peerConnection = new RTCPeerConnection(iceServers);
        
        console.log('Додавання локальних треків...');
        // Додавання локальних треків
        localStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, localStream);
        });
        
        // Обробка вхідних потоків
        peerConnection.ontrack = (event) => {
          console.log('Отримано віддалені треки');
          remoteStream = event.streams[0];
          remoteVideo.srcObject = remoteStream;
        };
        
        // Обробка ICE кандидатів
        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            console.log('Створено ICE кандидата');
            const targetUser = incomingCall ? incomingUserId : selectedUser;
            socket.emit('ice-candidate', {
              target: targetUser,
              source: myUserId,
              candidate: event.candidate
            });
          }
        };
  
        // Відстеження стану з'єднання
        peerConnection.oniceconnectionstatechange = () => {
          console.log('ICE стан змінено:', peerConnection.iceConnectionState);
          if (peerConnection.iceConnectionState === 'connected' || 
              peerConnection.iceConnectionState === 'completed') {
            updateStatus('Дзвінок активний');
            endCallButton.classList.remove('hidden');
          } else if (peerConnection.iceConnectionState === 'disconnected' || 
                     peerConnection.iceConnectionState === 'failed' || 
                     peerConnection.iceConnectionState === 'closed') {
            endCall();
          }
        };
        
        return peerConnection;
      } catch (error) {
        console.error('Помилка створення підключення:', error);
        updateStatus(`Помилка підключення: ${error.message}`);
      }
    }
  
    // Ініціювання дзвінка
    callButton.addEventListener('click', async () => {
      console.log('Ініціювання дзвінка до:', selectedUser);
      
      if (!selectedUser) {
        alert('Будь ласка, оберіть користувача!');
        return;
      }
      
      try {
        updateStatus(`Дзвінок до ${selectedUser}...`);
        callButton.disabled = true;
        
        await createPeerConnection();
        
        // Створення пропозиції
        console.log('Створення пропозиції...');
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        console.log('Відправка пропозиції...');
        socket.emit('offer', {
          target: selectedUser,
          source: myUserId,
          offer: offer
        });
        
        endCallButton.classList.remove('hidden');
      } catch (error) {
        console.error('Помилка ініціювання дзвінка:', error);
        updateStatus(`Помилка дзвінка: ${error.message}`);
        callButton.disabled = false;
      }
    });
  
    // Відповідь на дзвінок
    answerButton.addEventListener('click', async () => {
      console.log('Відповідь на дзвінок від:', incomingUserId);
      
      try {
        updateStatus(`Відповідь на дзвінок від ${incomingUserId}...`);
        answerButton.disabled = true;
        
        // Створення відповіді
        console.log('Створення відповіді...');
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        console.log('Відправка відповіді...');
        socket.emit('answer', {
          target: incomingUserId,
          source: myUserId,
          answer: answer
        });
        
        answerButton.classList.add('hidden');
        endCallButton.classList.remove('hidden');
        incomingCall = false;
      } catch (error) {
        console.error('Помилка відповіді на дзвінок:', error);
        updateStatus(`Помилка відповіді: ${error.message}`);
        answerButton.disabled = false;
      }
    });
  
    // Завершення дзвінка
    endCallButton.addEventListener('click', endCall);
  
    function endCall() {
      console.log('Завершення дзвінка');
      
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      
      remoteVideo.srcObject = null;
      incomingCall = false;
      callButton.disabled = false;
      answerButton.disabled = false;
      
      callButton.classList.remove('hidden');
      answerButton.classList.add('hidden');
      endCallButton.classList.add('hidden');
      
      updateStatus('Дзвінок завершено');
    }
    
    // Початковий статус
    updateStatus('Будь ласка, введіть ім\'я та зареєструйтесь');
    console.log('Ініціалізація клієнта завершена');
  });