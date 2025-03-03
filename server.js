const express = require('express');
const https = require('https'); // Замінюємо http на https
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();

// Завантаження сертифіката та ключа
const options = {
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
  key: fs.readFileSync(path.join(__dirname, 'key.pem'))
};

// Створення HTTPS-сервера
const server = https.createServer(options, app);
const io = socketIo(server, {
  cors: {
    origin: '*', // Дозволяємо підключення з будь-якого джерела (для тесту)
    methods: ['GET', 'POST']
  }
});

// Шлях до папки public
const publicPath = path.join(__dirname, 'public');

// Створення папки public, якщо її немає
if (!fs.existsSync(publicPath)) {
  fs.mkdirSync(publicPath);
  console.log('Створено папку public');
}

// Перевірка наявності файлів index.html і app.js
const requiredFiles = ['index.html', 'app.js'];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(publicPath, file))) {
    console.error(`Помилка: файл ${file} відсутній у папці public!`);
    process.exit(1);
  }
}

// Налаштування статичних файлів
app.use(express.static(publicPath));

// Маршрут для головної сторінки
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Зберігання активних користувачів
const users = {};

// Події Socket.io
io.on('connection', (socket) => {
  console.log(`Новий користувач підключився: ${socket.id}`);

  // Реєстрація користувача
  socket.on('register', (userId) => {
    users[userId] = socket.id;
    console.log(`Користувач зареєстрований: ${userId} (Socket ID: ${socket.id})`);
    io.emit('update-users', Object.keys(users)); // Оновлюємо список користувачів
  });

  // Передача пропозиції дзвінка (offer)
  socket.on('offer', (data) => {
    const { target, source, offer } = data;
    const targetSocketId = users[target];
    if (targetSocketId) {
      console.log(`Передаю offer від ${source} до ${target}`);
      io.to(targetSocketId).emit('offer', { offer, source });
    } else {
      console.log(`Користувач ${target} не знайдений`);
    }
  });

  // Передача відповіді (answer)
  socket.on('answer', (data) => {
    const { target, source, answer } = data;
    const targetSocketId = users[target];
    if (targetSocketId) {
      console.log(`Передаю answer від ${source} до ${target}`);
      io.to(targetSocketId).emit('answer', { answer, source });
    }
  });

  // Передача ICE-кандидатів
  socket.on('ice-candidate', (data) => {
    const { target, source, candidate } = data;
    const targetSocketId = users[target];
    if (targetSocketId) {
      console.log(`Передаю ICE-кандидат від ${source} до ${target}`);
      io.to(targetSocketId).emit('ice-candidate', { candidate, source });
    }
  });

  // Обробка відключення
  socket.on('disconnect', () => {
    const userId = Object.keys(users).find((key) => users[key] === socket.id);
    if (userId) {
      delete users[userId];
      console.log(`Користувач ${userId} відключився`);
      io.emit('update-users', Object.keys(users));
    }
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTPS-сервер запущено на https://0.0.0.0:${PORT}`);

  // Виведення локальних IP-адрес
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  console.log('Доступні адреси для підключення:');
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`https://${net.address}:${PORT}`);
      }
    }
  }
  console.log('Відкрийте одну з адрес у браузері на iPhone/iPad');
});