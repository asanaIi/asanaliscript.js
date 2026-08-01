const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const glob = require('glob');

/**
 * Мост для связи JavaScript внутри window() с Python-базой данных
 * (В JS версии используется локальный JSON файл напрямую)
 */
class AScriptBridge {
    constructor(dbPath = "ascript_db.json") {
        this.dbPath = dbPath;
        if (!fs.existsSync(this.dbPath)) {
            fs.writeFileSync(this.dbPath, JSON.stringify({}), { encoding: 'utf-8' });
        }
    }

    saveData(key, value) {
        const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
        data[key] = value;
        fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 4), { encoding: 'utf-8' });
        return `[database] Сохранено: ${key}`;
    }

    getData(key) {
        const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
        return data[key] !== undefined ? data[key] : "Не найдено";
    }
}

class AScriptInterpreter {
    constructor() {
        this.variables = {
            'User': os.userInfo().username,
            'ARCH': process.platform,
            'VERSION': '2.1.0-TS'
        };
        this.interfaces = {};
        this.lines = [];
        this.currentLine = 0;

        // Инициализация синтезатора речи
        // В Node.js для кроссплатформенного TTS часто используется say или внешние утилиты
        try {
            this.say = require('say');
        } catch (e) {
            this.say = null;
        }
    }

    /**
     * Удаляет многострочные /* ... * / и однострочные // комментарии.
     * Игнорирует блоки window(...), сохраняя внутри HTML/CSS.
     */
    stripComments(code) {
        const parts = code.split(/(window\s*\(.*?\))/gs);
        const processedParts = [];

        for (const part of parts) {
            if (part.startsWith("window")) {
                processedParts.push(part);
            } else {
                let cleaned = part.replace(/\/\*[\s\S]*?\*\//g, '');
                cleaned = cleaned.replace(/\/\/.*$/gm, '');
                processedParts.push(cleaned);
            }
        }

        return processedParts.join("");
    }

    /**
     * Поддерживает интерполяцию обычных переменных ($var) 
     * и вложенных свойств объектов ($massiveVariable.price).
     */
    replaceVariables(text) {
        // 1. Поиск вложенных свойств $obj.prop
        text = text.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, objName, propName) => {
            if (this.variables[objName] && typeof this.variables[objName] === 'object' && !Array.isArray(this.variables[objName])) {
                return String(this.variables[objName][propName] !== undefined ? this.variables[objName][propName] : `$${objName}.${propName}`);
            }
            return match;
        });

        // 2. Поиск обычных скалярных переменных $var
        for (const [varName, val] of Object.entries(this.variables)) {
            if (typeof val !== 'object' || val === null) {
                // Используем split/join для замены всех вхождений без regex escape проблем
                text = text.split(`$${varName}`).join(String(val));
            }
        }

        return text;
    }

    /** Строгая валидация типов TypeScript */
    checkType(valStr, expectedType) {
        valStr = valStr.trim();
        expectedType = expectedType.trim();

        if (expectedType === "string") {
            if ((valStr.startsWith('"') && valStr.endsWith('"')) ||
                (valStr.startsWith("'") && valStr.endsWith("'"))) {
                return [true, valStr.slice(1, -1)];
            }
            return [false, "Значение должно быть строкой в кавычках"];
        }

        else if (expectedType === "number") {
            if (/^\d+$/.test(valStr)) {
                return [true, parseInt(valStr, 10)];
            }
            const f = parseFloat(valStr);
            if (!isNaN(f)) {
                return [true, f];
            }
            return [false, "Значение должно быть числом"];
        }

        else if (expectedType === "boolean") {
            if (valStr === "true" || valStr === "false") {
                return [true, valStr === "true"];
            }
            return [false, "Значение должно быть true или false"];
        }

        return [true, valStr];
    }

    evaluateCondition(conditionStr) {
        conditionStr = this.replaceVariables(conditionStr);
        if (conditionStr.includes("==")) {
            const [left, right] = conditionStr.split("==");
            return left.trim().replace(/^['"]|['"]$/g, '') === right.trim().replace(/^['"]|['"]$/g, '');
        }
        if (conditionStr.includes("!=")) {
            const [left, right] = conditionStr.split("!=");
            return left.trim().replace(/^['"]|['"]$/g, '') !== right.trim().replace(/^['"]|['"]$/g, '');
        }
        return false;
    }

    skipBlock() {
        let braceCount = 0;
        while (this.currentLine < this.lines.length) {
            const line = this.lines[this.currentLine].trim();
            if (line.includes("{")) {
                braceCount += (line.match(/{/g) || []).length;
            }
            if (line.includes("}")) {
                braceCount -= (line.match(/}/g) || []).length;
                if (braceCount <= 0) {
                    this.currentLine += 1;
                    break;
                }
            }
            this.currentLine += 1;
        }
    }

    executeBlockContent(endTrigger = "}") {
        const blockLines = [];
        let braceCount = 1;
        while (this.currentLine < this.lines.length) {
            const line = this.lines[this.currentLine];
            const cleanLine = line.trim();

            if (cleanLine.includes("{")) {
                braceCount += (cleanLine.match(/{/g) || []).length;
            }
            if (cleanLine.includes(endTrigger)) {
                braceCount -= (cleanLine.match(new RegExp(endTrigger, 'g')) || []).length;
                if (braceCount === 0) {
                    this.currentLine += 1;
                    break;
                }
            }

            blockLines.push(line);
            this.currentLine += 1;
        }
        return blockLines.join("\n");
    }

    /** Преобразует JS-подобный объект { key: value } в Python-словарь (JS Object) */
    parseObject(rawStr) {
        // Превращаем ключи без кавычек в валидный JSON (price: 100 -> "price": 100)
        let jsonLike = rawStr.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '"$1":');
        // В JS true/false уже валидны для JSON.parse, если это стандартный JSON формат
        return JSON.parse(jsonLike);
    }

    runFile(filename) {
        if (!fs.existsSync(filename)) {
            return false;
        }

        const rawCode = fs.readFileSync(filename, 'utf-8');
        const cleanCode = this.stripComments(rawCode);
        this.lines = cleanCode.split(/\r?\n/).filter(line => line.trim() !== "");

        this.currentLine = 0;
        while (this.currentLine < this.lines.length) {
            const line = this.lines[this.currentLine];
            const cleanLine = line.trim();

            // --- 1. Интерфейсы TypeScript ---
            if (cleanLine.startsWith("interface ")) {
                const match = cleanLine.match(/interface\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
                if (match) {
                    const ifName = match[1];
                    this.currentLine += 1;
                    const ifBody = this.executeBlockContent();
                    this.interfaces[ifName] = ifBody;
                } else {
                    this.currentLine += 1;
                }
            }

            // --- 2. Переменные let / const (числа, строки, объекты { }) ---
            else if (cleanLine.startsWith("let ") || cleanLine.startsWith("const ")) {
                const content = cleanLine.replace(/^(let|const)\s+/, '');
                const match = content.match(/([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*:\s*([a-zA-Z0-9_<>|]+))?\s*=\s*(.*)/);
                
                if (match) {
                    const varName = match[1];
                    const varType = match[2];
                    let rawVal = match[3].trim();

                    // А) Если присваивается объект { ... }
                    if (rawVal.startsWith("{")) {
                        let objStr = rawVal;
                        while (!objStr.endsWith("}") && this.currentLine + 1 < this.lines.length) {
                            this.currentLine += 1;
                            objStr += " " + this.lines[this.currentLine].trim();
                        }
                        
                        try {
                            const parsedObj = this.parseObject(objStr);
                            this.variables[varName] = parsedObj;
                        } catch (e) {
                            console.error(`[aScript Error] Ошибка синтаксиса объекта '${varName}': ${e.message}`);
                            process.exit(1);
                        }
                    }

                    // Б) Обычное скалярное значение
                    else {
                        if (varType) {
                            const [isValid, parsedVal] = this.checkType(rawVal, varType);
                            if (!isValid) {
                                console.error(`[TypeError] Ошибка в строке ${this.currentLine + 1}: '${varName}' ожидает тип '${varType}', получено: ${rawVal}`);
                                process.exit(1);
                            }
                            this.variables[varName] = parsedVal;
                        } else {
                            const varValue = rawVal.replace(/^['"]|['"]$/g, '').trim();
                            this.variables[varName] = this.replaceVariables(varValue);
                        }
                    }
                }
                this.currentLine += 1;
            }

            // --- 3. Вывод echo ---
            else if (cleanLine.startsWith("echo ")) {
                console.log(this.replaceVariables(cleanLine.slice(5).trim()));
                this.currentLine += 1;
            }

            // --- 4. CLI Модуль ---
            else if (cleanLine.startsWith("cli.")) {
                if (cleanLine.startsWith("cli.args")) {
                    console.log(`[CLI Args]: ${process.argv.slice(2)}`);
                } else if (cleanLine.startsWith("cli.exec ")) {
                    const cmd = this.replaceVariables(cleanLine.slice(9).trim().replace(/^['"]|['"]$/g, ''));
                    try {
                        const res = execSync(cmd, { encoding: 'utf-8' });
                        console.log(res);
                    } catch (e) {
                        console.error(e.stderr);
                    }
                } else if (cleanLine === "cli.exit()") {
                    process.exit(0);
                }
                this.currentLine += 1;
            }

            // --- 5. Класс звука и речи ---
            else if (cleanLine.startsWith("class sound {") || cleanLine.startsWith("class sound{")) {
                this.currentLine += 1;
                const soundCode = this.executeBlockContent();
                this.processSound(soundCode);
            }

            // --- 6. Условия if / else ---
            else if (cleanLine.startsWith("if ")) {
                const match = cleanLine.match(/if\s+(.*)\s*\{/);
                if (match) {
                    const condition = match[1];
                    this.currentLine += 1;
                    if (this.evaluateCondition(condition)) {
                        continue;
                    } else {
                        this.skipBlock();
                        if (this.currentLine < this.lines.length && this.lines[this.currentLine].includes("else")) {
                            this.currentLine += 1;
                            this.skipBlock();
                        }
                    }
                } else {
                    this.currentLine += 1;
                }
            }

            else if (cleanLine.startsWith("else")) {
                this.currentLine += 1;
                this.skipBlock();
            }

            // --- 7. Подключение и запись файлов join ---
            else if (cleanLine.startsWith("join ")) {
                const match = cleanLine.match(/join\s+['\"](.*?)['\"]\s*\{/);
                if (match) {
                    const fileTarget = this.replaceVariables(match[1]);
                    this.currentLine += 1;
                    const innerCode = this.executeBlockContent();

                    if (innerCode.includes("write")) {
                        const textToWriteMatch = innerCode.match(/write\s+['\"](.*?)['\"]/);
                        if (textToWriteMatch) {
                            fs.writeFileSync(fileTarget, this.replaceVariables(textToWriteMatch[1]), { encoding: 'utf-8' });
                        }
                    }
                } else {
                    this.currentLine += 1;
                }
            }

            // --- 8. База данных database() ---
            else if (cleanLine.startsWith("database(")) {
                this.currentLine += 1;
                this.executeBlockContent(")");
                console.log("[aScript DB] База данных инициализирована.");
            }

            // --- 9. Системная инфа ---
            else if (cleanLine === "show sys.info") {
                console.log(`\n--- aScript System Info ---\nUser: ${this.variables['User']}\nOS: ${process.platform}\nVersion: ${this.variables['VERSION']}\n`);
                this.currentLine += 1;
            }

            // --- 10. Поиск файлов open ---
            else if (cleanLine.startsWith("open ")) {
                const rawPath = cleanLine.slice(5).trim();
                const resolvedPath = this.replaceVariables(rawPath);
                const files = glob.sync(resolvedPath);
                if (files.length > 0) {
                    for (const f of files) {
                        console.log(`-> Доступ открыт: ${path.basename(f)}`);
                    }
                } else {
                    console.log("-> Файлы не найдены.");
                }
                this.currentLine += 1;
            }

            // --- 11. Графика window() ---
            else if (cleanLine.startsWith("window(")) {
                this.currentLine += 1;
                const uiCode = this.executeBlockContent(")");
                this.renderWindow(uiCode);
            } else {
                this.currentLine += 1;
            }
        }
        return true;
    }

    processSound(code) {
        const lines = code.split("\n");
        for (let l of lines) {
            l = l.trim();
            if (l.startsWith("echo ")) {
                const textToSpeak = this.replaceVariables(l.slice(5).trim().replace(/^['"]|['"]$/g, ''));
                console.log(`[Робот говорит]: ${textToSpeak}`);
                if (this.say) {
                    this.say.speak(textToSpeak);
                }
            }

            else if (l.startsWith("tone ")) {
                const parts = l.slice(5).split(/\s+/);
                if (parts.length >= 1) {
                    const freq = parseInt(this.replaceVariables(parts[0]), 10);
                    if (process.platform === "win32") {
                        // В Node.js нет прямого аналога winsound.Beep без внешних зависимостей.
                        // Используем PowerShell для генерации звука на Windows.
                        spawnSync('powershell.exe', ['-Command', `[console]::beep(${freq}, 400)`]);
                    }
                }
            }
        }
    }

    renderWindow(fullCode) {
        let cssStyle = "";
        let htmlContent = fullCode;

        const styleMatch = fullCode.match(/const style\s*=\s*`([\s\S]*?)`/);
        if (styleMatch) {
            cssStyle = styleMatch[1];
            htmlContent = fullCode.replace(styleMatch[0], "");
        }

        const htmlTemplate = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { margin: 0; padding: 20px; font-family: 'Segoe UI', sans-serif; background: #111216; color: #fff; display: flex; flex-direction: column; align-items: center; }
                ${cssStyle}
            </style>
        </head>
        <body>
            ${htmlContent}
            <script>
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                
                function playBeep(freq, vol) {
                    let osc = audioCtx.createOscillator();
                    let gain = audioCtx.createGain();
                    osc.type = 'sine';
                    osc.frequency.value = freq;
                    gain.gain.value = vol || 0.1;
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start();
                    setTimeout(() => osc.stop(), 150);
                }

                // В Node.js реализации window() мы предполагаем наличие механизма взаимодействия,
                // аналогичного pywebview. Здесь это заглушки для демонстрации структуры.
                function saveToDB(key, val) { 
                    console.log("Saving to DB:", key, val);
                    // В реальном приложении здесь был бы вызов через IPC (например, в Electron)
                }
                function getFromDB(key) { 
                    console.log("Getting from DB:", key);
                }
            </script>
        </body>
        </html>
        `;
        
        // В Python используется pywebview. В Node.js аналогом является Electron или open.
        // Для сохранения простоты и переносимости скрипта, мы выводим HTML или открываем в браузере.
        console.log("[aScript Engine] Rendering window content...");
        const tempFile = path.join(os.tmpdir(), 'ascript_window.html');
        fs.writeFileSync(tempFile, htmlTemplate);
        
        const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        execSync(`${openCmd} ${tempFile}`);
    }
}

// Main execution
if (require.main === module) {
    // Автоустановка в PATH для Windows
    if (process.platform === "win32") {
        const exeDir = __dirname;
        try {
            // В Node.js работа с реестром требует внешних библиотек (regedit) или PowerShell.
            // Используем PowerShell для проверки и установки PATH.
            const checkPathCmd = `[Environment]::GetEnvironmentVariable("Path", "User")`;
            const currentPath = execSync(`powershell.exe -Command "${checkPathCmd}"`, { encoding: 'utf-8' }).trim();

            if (!currentPath.includes(exeDir)) {
                const newPath = currentPath ? `${currentPath};${exeDir}` : exeDir;
                const setPathCmd = `[Environment]::SetEnvironmentVariable("Path", "${newPath.replace(/"/g, '`"')}", "User")`;
                execSync(`powershell.exe -Command "${setPathCmd}"`);
                // Оповещение системы об изменении окружения (аналог SendMessageTimeoutW)
                // В Node.js это сложно сделать без нативных аддонов, обычно требуется перезапуск терминала.
            }
        } catch (e) {
            // Игнорируем ошибки доступа
        }
    }

    const interpreter = new AScriptInterpreter();

    if (process.argv.length > 2) {
        interpreter.runFile(process.argv[2]);
    } else {
        let found = false;
        for (const defaultFile of ["index.asc", "index.ascript", "main.asc", "main.ascript"]) {
            if (interpreter.runFile(defaultFile)) {
                found = true;
                process.exit(0);
            }
        }

        if (!found) {
            console.log("Asanali Script (aScript) v2.1 TS Engine");
            console.log("Использование: node aScript.js <файл.asc|файл.ascript>");
            
            // Аналог input() для выхода
            const readline = require('readline').createInterface({
                input: process.stdin,
                output: process.stdout
            });
            readline.question("\nНажми Enter для выхода...", () => {
                readline.close();
                process.exit(0);
            });
        }
    }
}
