const isBrowser = typeof window !== 'undefined';

if (isBrowser) {
    // для сайта
    document.addEventListener("DOMContentLoaded", async () => {
        const scripts = document.querySelectorAll('script[type="text/asanaliscript"]');
        
        for (const script of scripts) {
            let code = script.textContent;
            const src = script.getAttribute('src');

            if (src) {
                try {
                    const response = await fetch(src);
                    code = await response.text();
                } catch (e) {
                    console.error("[AsanaliScript Browser] Ошибка загрузки файла:", src, e);
                    continue;
                }
            }
            if (code) {
                const match = code.match(/(?:html\s*=\s*\{|web\.server.*?\{|window\s*\()([\s\S]*?)(?:\}|\))/);
                
                let htmlContent = "";
                if (match) {
                    htmlContent = match[1];
                } else {
                    htmlContent = code;
                }

                htmlContent = htmlContent.replace(/\$VERSION/g, '2.1.0-TS');
                htmlContent = htmlContent.replace(/\$User/g, 'WebUser');
                htmlContent = htmlContent.replace(/\$ARCH/g, navigator.platform || 'Web');

                const root = document.createElement('div');
                root.className = 'ascript-rendered-ui';
                root.innerHTML = htmlContent;
                document.body.appendChild(root);
            }
        }
    });

} else {
    // интерпретатор
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const http = require('http');
    const { execSync, spawnSync } = require('child_process');
    const glob = require('glob');

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
                'VERSION': '1.0.5'
            };
            this.interfaces = {};
            this.routes = {};
            this.lines = [];
            this.currentLine = 0;

            try {
                this.say = require('say');
            } catch (e) {
                this.say = null;
            }
        }

        stripComments(code) {
            const parts = code.split(/(window\s*\(.*?\)|html\s*=\s*\{.*?\})/gs);
            const processedParts = [];

            for (const part of parts) {
                if (part.startsWith("window") || part.startsWith("html")) {
                    processedParts.push(part);
                } else {
                    let cleaned = part.replace(/\/\*[\s\S]*?\*\//g, '');
                    cleaned = cleaned.replace(/\/\/.*$/gm, '');
                    processedParts.push(cleaned);
                }
            }

            return processedParts.join("");
        }

        replaceVariables(text) {
            text = text.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, objName, propName) => {
                if (this.variables[objName] && typeof this.variables[objName] === 'object' && !Array.isArray(this.variables[objName])) {
                    return String(this.variables[objName][propName] !== undefined ? this.variables[objName][propName] : `$${objName}.${propName}`);
                }
                return match;
            });

            for (const [varName, val] of Object.entries(this.variables)) {
                if (typeof val !== 'object' || val === null) {
                    text = text.split(`$${varName}`).join(String(val));
                }
            }

            return text;
        }

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

        parseObject(rawStr) {
            let jsonLike = rawStr.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '"$1":');
            return JSON.parse(jsonLike);
        }

        buildWebHTML(rawUI) {
            const parsedHTML = this.replaceVariables(rawUI);

            return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
    ${parsedHTML}
</body>
</html>`;
        }

        startWebServer(port = 3000, defaultHtml = "") {
            const server = http.createServer((req, res) => {
                const url = req.url;

                if (this.routes[url]) {
                    const routeData = this.routes[url];
                    res.writeHead(200, { 'Content-Type': routeData.type || 'text/html; charset=utf-8' });
                    res.end(this.replaceVariables(routeData.content));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(defaultHtml);
            });

            server.listen(port, () => {
                console.log(`\nСервер сайта работает на http://localhost:${port}`);
            });
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

                else if (cleanLine.startsWith("let ") || cleanLine.startsWith("const ")) {
                    const content = cleanLine.replace(/^(let|const)\s+/, '');
                    const match = content.match(/([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*:\s*([a-zA-Z0-9_<>|]+))?\s*=\s*(.*)/);
                    
                    if (match) {
                        const varName = match[1];
                        const varType = match[2];
                        let rawVal = match[3].trim();

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
                                console.error(`Ошибка синтаксиса объекта '${varName}': ${e.message}`);
                                process.exit(1);
                            }
                        } else {
                            if (varType) {
                                const [isValid, parsedVal] = this.checkType(rawVal, varType);
                                if (!isValid) {
                                    console.error(`Ошибка в строке ${this.currentLine + 1}: '${varName}' ожидает тип '${varType}', получено: ${rawVal}`);
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

                else if (cleanLine.startsWith("echo ")) {
                    console.log(this.replaceVariables(cleanLine.slice(5).trim()));
                    this.currentLine += 1;
                }

                else if (cleanLine.startsWith("route ")) {
                    const match = cleanLine.match(/route\s+(GET|POST)\s+['\"](.*?)['\"]\s*\{/);
                    if (match) {
                        const routePath = match[2];
                        this.currentLine += 1;
                        const routeContent = this.executeBlockContent();
                        
                        this.routes[routePath] = {
                            type: routePath.endsWith(".json") ? "application/json" : "text/html; charset=utf-8",
                            content: routeContent
                        };
                    } else {
                        this.currentLine += 1;
                    }
                }

                else if (cleanLine.startsWith("server ") || cleanLine.startsWith("web.server")) {
                    const matchPort = cleanLine.match(/port\s*=\s*(\d+)/);
                    const port = matchPort ? parseInt(matchPort[1], 10) : 3000;

                    this.currentLine += 1;
                    const serverCode = this.executeBlockContent();
                    const htmlOutput = this.buildWebHTML(serverCode);
                    
                    this.startWebServer(port, htmlOutput);
                }

                else if (cleanLine.startsWith("html = {") || cleanLine.startsWith("html={")) {
                    this.currentLine += 1;
                    const uiCode = this.executeBlockContent("}");
                    this.renderWindow(uiCode);
                }

                else if (cleanLine.startsWith("window(")) {
                    this.currentLine += 1;
                    const uiCode = this.executeBlockContent(")");
                    this.renderWindow(uiCode);
                }

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

                else if (cleanLine.startsWith("class sound {") || cleanLine.startsWith("class sound{")) {
                    this.currentLine += 1;
                    const soundCode = this.executeBlockContent();
                    this.processSound(soundCode);
                }

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

                else if (cleanLine.startsWith("database(")) {
                    this.currentLine += 1;
                    this.executeBlockContent(")");
                    console.log("База данных инициализирована.");
                }

                else if (cleanLine === "show sys.info") {
                    console.log(`\nSystem Info\nUser: ${this.variables['User']}\nOS: ${process.platform}\nVersion: ${this.variables['VERSION']}\n`);
                    this.currentLine += 1;
                }

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
                } else {
                    this.currentLine += 1;
                }
            }
            return true;
        }

        processSound(code) {
            const lines = code.split("\n");
            for (let l of lines) {
                l = l.strip ? l.strip() : l.trim();
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
                            spawnSync('powershell.exe', ['-Command', `[console]::beep(${freq}, 400)`]);
                        }
                    }
                }
            }
        }

        renderWindow(fullCode) {
            const htmlTemplate = this.buildWebHTML(fullCode);
            
            console.log("[aScript Engine] Генерация веб-интерфейса...");
            const tempFile = path.join(os.tmpdir(), 'ascript_web_interface.html');
            fs.writeFileSync(tempFile, htmlTemplate, { encoding: 'utf-8' });
            
            const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
            execSync(`${openCmd} ${tempFile}`);
        }
    }

    if (require.main === module) {
        if (process.platform === "win32") {
            const exeDir = __dirname;
            try {
                const checkPathCmd = `[Environment]::GetEnvironmentVariable("Path", "User")`;
                const currentPath = execSync(`powershell.exe -Command "${checkPathCmd}"`, { encoding: 'utf-8' }).trim();

                if (!currentPath.includes(exeDir)) {
                    const newPath = currentPath ? `${currentPath};${exeDir}` : exeDir;
                    const setPathCmd = `[Environment]::SetEnvironmentVariable("Path", "${newPath.replace(/"/g, '`"')}", "User")`;
                    execSync(`powershell.exe -Command "${setPathCmd}"`);
                }
            } catch (e) {}
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
                console.log("AsanaliScript (aScript) 1.0.5");
                console.log("Использование: node aScript.js <файл.asc|файл.ascript>");
                
                const readline = require('readline').createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                readline.question("\nНажмите Enter для выхода...", () => {
                    readline.close();
                    process.exit(0);
                });
            }
        }
    }
}