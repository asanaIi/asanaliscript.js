# <img src="https://asanaliscript-officialsite.onrender.com/icon.png" width=25/> AsanaliScript.js

asanaliscript.js — это легкий, фановый и мощный скриптовый фреймворк языка программирования AsanaliScript. Он сочетает в себе простоту системных команд `.bat` файлов, гибкость Python и возможности веб-интерфейсов.

## Главные фичи
* **Встроенный движок окон:** Через команду `html = {}` можно мгновенно развернуть сайт.
* **Голосовой и тональный класс:** Блок `class sound` умеет озвучивать текст голосом робота и генерировать чистые звуковые частоты.

## Пример кода на asanaliscript.js<br> ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿<br>⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿<br>⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿<br>⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿<br>⣿⣿⣿⣿⣿⣿⣿⣿⣿⠛⠻⣿⣿⡿⠟⠛⠿⣿⣿⣿<br>⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⣿⡏⠀⢠⣦⣄⣼⣿⣿<br>⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⣿⣧⡀⠈⠙⠻⢿⣿⣿<br>⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⣿⣿⣿⣷⣦⡄⠀⢹⣿<br>⣿⣿⣿⣿⣿⣏⠀⠉⠉⠀⣰⣿⣅⠀⠉⠋⠁⢀⣼⣿<br>⣿⣿⣿⣿⣿⣿⣿⣶⣶⣿⣿⣿⣿⣿⣶⣶⣾⣿⣿⣿<br>


```JavaScript
const AScriptInterpreter = require('asanaliscript'); // Легендарное подключение библиотеки


const interpreter = new AScriptInterpreter(); // Экземпляр интерпретатора

// Кастомные переменные из Node.js перед запуском скрипта
interpreter.variables['CustomToken'] = 'SECRET_123';
interpreter.variables['Environment'] = 'Production';

const success = interpreter.runFile('main.asc'); // Запускаем внешний файл AsanaliScript (если есть)

if (success) {
    console.log("Скрипт обработан.");
} else {
    console.log("Что-то пошло не так, проверьте начилие файла 'main.asc'.");
}
```

## Установка пакета ![](https://img.shields.io/badge/%20-FFFFFF?logo=npm&logoColor=red):
```bash
npm i asanaliscript
```

## Подключение библиотеки <img src="https://asanaliscript-officialsite.onrender.com/icon.png" width=25/> from '<img src="https://img.shields.io/badge/%20-white?style=for-the-badge&logo=npm&logoColor=red" width=32/>'
>1: `const asanaliscript = require('asanaliscript')`<br>
>2: `import asanaliscript from 'asanaliscript'` (если у вас есть установленный asanaliscript в node_modules)<br>
>3: `import asanaliscript from 'https://cdn.jsdelivr.net/npm/asanaliscript@1.0.5'`