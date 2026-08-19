const calculator = document.getElementById("calculator");
const display = document.getElementById("display");
const buttonArea = document.getElementById("calculator-buttons");
const powerButton = buttonArea.querySelector('[data-action="power"]');
const controllableButtons = buttonArea.querySelectorAll(
    'button:not([data-action="power"])'
);

const ERROR_MESSAGE = "Error";
const DIVIDE_BY_ZERO_MESSAGE = "0으로 나눌 수 없음";

let currentFormula = "";
let isPowerOn = true;
let isCalculated = false;

// 수식에 사용되는 연산을 한곳에서 관리한다.
const operations = {
    "+": (left, right) => left + right,
    "-": (left, right) => left - right,
    "*": (left, right) => left * right,
    "/": (left, right) => left / right
};

function formatFormula(formula) {
    return formula
        .replace(/\*/g, "×")
        .replace(/\//g, "÷")
        .replace(/-/g, "−");
}

function renderFormula() {
    display.value = currentFormula ? formatFormula(currentFormula) : "0";
}

function resetCalculator() {
    currentFormula = "";
    isCalculated = false;
    display.value = "0";
}

function togglePower() {
    isPowerOn = !isPowerOn;

    calculator.classList.toggle("is-off", !isPowerOn);
    powerButton.classList.toggle("is-on", isPowerOn);
    powerButton.setAttribute("aria-pressed", String(isPowerOn));

    controllableButtons.forEach((button) => {
        button.disabled = !isPowerOn;
    });

    currentFormula = "";
    isCalculated = false;
    display.value = isPowerOn ? "0" : "";
}

function getCurrentNumber() {
    if (!currentFormula) {
        return "";
    }

    const tokens = currentFormula.trim().split(/\s+/);
    const lastToken = tokens[tokens.length - 1];

    if (["+", "-", "*", "/"].includes(lastToken)) {
        return "";
    }

    return lastToken;
}

function appendNumber(number) {
    if (!isPowerOn) {
        return;
    }

    // 계산 직후 숫자를 누르면 새로운 계산을 시작한다.
    if (isCalculated) {
        currentFormula = "";
        isCalculated = false;
    }

    const currentNumber = getCurrentNumber();

    // 한 숫자 안에는 소수점을 한 번만 허용한다.
    if (number === "." && currentNumber.includes(".")) {
        return;
    }

    // 소수점부터 입력하면 0.으로 시작한다.
    if (number === "." && currentNumber === "") {
        number = "0.";
    }

    // 05처럼 불필요한 앞자리 0이 생기지 않게 처리한다.
    if (number !== "." && currentNumber === "0") {
        currentFormula = currentFormula.slice(0, -1) + number;
    } else {
        currentFormula += number;
    }

    renderFormula();
}

function appendOperator(operator) {
    if (!isPowerOn) {
        return;
    }

    if (
        display.value === ERROR_MESSAGE ||
        display.value === DIVIDE_BY_ZERO_MESSAGE
    ) {
        return;
    }

    if (!currentFormula) {
        currentFormula = "0";
    }

    // 연산자를 연속으로 누르면 마지막 연산자만 교체한다.
    if (currentFormula.endsWith(" ")) {
        currentFormula = currentFormula.slice(0, -3);
    }

    currentFormula += ` ${operator} `;
    isCalculated = false;
    renderFormula();
}

function clearDisplay() {
    if (!isPowerOn) {
        return;
    }

    resetCalculator();
}

function runOperation(left, operator, right) {
    if (!(operator in operations)) {
        return ERROR_MESSAGE;
    }

    if (operator === "/" && right === 0) {
        return DIVIDE_BY_ZERO_MESSAGE;
    }

    const result = operations[operator](left, right);
    return Number.isFinite(result) ? result : ERROR_MESSAGE;
}

function normalizeResult(value) {
    // 부동소수점 오차를 줄여 0.1 + 0.2가 길게 표시되는 것을 방지한다.
    return Number(value.toFixed(10));
}

function calculate(formula) {
    const tokens = formula.trim().split(/\s+/);

    if (tokens.length % 2 === 0) {
        return ERROR_MESSAGE;
    }

    if (tokens.length === 1) {
        const singleValue = Number(tokens[0]);
        return Number.isFinite(singleValue)
            ? normalizeResult(singleValue)
            : ERROR_MESSAGE;
    }

    // 1단계: 곱셈과 나눗셈을 먼저 계산한다.
    const intermediateTokens = [tokens[0]];

    for (let index = 1; index < tokens.length; index += 2) {
        const operator = tokens[index];
        const right = Number(tokens[index + 1]);

        if (!Number.isFinite(right)) {
            return ERROR_MESSAGE;
        }

        if (operator === "*" || operator === "/") {
            const left = Number(intermediateTokens.pop());
            const result = runOperation(left, operator, right);

            if (typeof result === "string") {
                return result;
            }

            intermediateTokens.push(result);
        } else {
            intermediateTokens.push(operator, right);
        }
    }

    // 2단계: 남은 덧셈과 뺄셈을 왼쪽부터 계산한다.
    let result = Number(intermediateTokens[0]);

    for (let index = 1; index < intermediateTokens.length; index += 2) {
        const operator = intermediateTokens[index];
        const right = Number(intermediateTokens[index + 1]);
        const operationResult = runOperation(result, operator, right);

        if (typeof operationResult === "string") {
            return operationResult;
        }

        result = operationResult;
    }

    return normalizeResult(result);
}

function performCalculate() {
    if (!isPowerOn || !currentFormula) {
        return;
    }

    // 마지막 입력이 연산자라면 해당 연산자만 제거한다.
    if (currentFormula.endsWith(" ")) {
        currentFormula = currentFormula.slice(0, -3);
    }

    const result = calculate(currentFormula);
    display.value = String(result);
    isCalculated = true;

    currentFormula = typeof result === "number" ? String(result) : "";
}

buttonArea.addEventListener("click", (event) => {
    const button = event.target.closest("button");

    if (!button || !buttonArea.contains(button)) {
        return;
    }

    const action = button.dataset.action;
    const value = button.dataset.value;

    if (action === "power") {
        togglePower();
    } else if (action === "clear") {
        clearDisplay();
    } else if (action === "number") {
        appendNumber(value);
    } else if (action === "operator") {
        appendOperator(value);
    } else if (action === "calculate") {
        performCalculate();
    }
});
