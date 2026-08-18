const operations = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => {
    if (b === 0) throw new Error("0으로 나눌 수 없습니다.");
    return a / b;
  }
};

function applyOperator(left, operator, right) {
  const fn = operations[operator];
  if (!fn) {
    throw new Error(`지원하지 않는 연산자입니다: ${operator}`);
  }
  return fn(left, right);
}

function calculate(formula) {
  const tokens = formula.trim().split(/\s+/);

  if (tokens.length < 3 || tokens.length % 2 === 0) {
    return "잘못된 계산식이 입력되었습니다.";
  }

  // 1단계: 곱셈/나눗셈 처리
  const priorityTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === "*" || token === "/") {
      const left = Number(priorityTokens.pop());
      const right = Number(tokens[i + 1]);

      if (Number.isNaN(left) || Number.isNaN(right)) {
        return "잘못된 숫자가 입력되었습니다.";
      }

      try {
        priorityTokens.push(applyOperator(left, token, right));
      } catch (error) {
        return error.message;
      }

      i++;
    } else {
      priorityTokens.push(token);
    }
  }

  // 2단계: 덧셈/뺄셈 처리
  let result = Number(priorityTokens[0]);
  if (Number.isNaN(result)) {
    return "잘못된 숫자가 입력되었습니다.";
  }

  for (let i = 1; i < priorityTokens.length; i += 2) {
    const operator = priorityTokens[i];
    const nextValue = Number(priorityTokens[i + 1]);

    if (Number.isNaN(nextValue)) {
      return "잘못된 숫자가 입력되었습니다.";
    }

    try {
      result = applyOperator(result, operator, nextValue);
    } catch (error) {
      return error.message;
    }
  }

  return result;
}

console.log(calculate("1 + 2 * 3")); // 7
console.log(calculate("10 / 2 + 3")); // 8