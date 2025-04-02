const sum = (a: number, b: number): number => {
  return a + b;
};

describe('Sample Test', () => {
  test('sum function should add two numbers correctly', () => {
    expect(sum(1, 2)).toBe(3);
  });
});
