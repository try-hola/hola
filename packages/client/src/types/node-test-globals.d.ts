declare module "node:test" {
  export const describe: (name: string, fn: Function) => void;
  export const it: (name: string, fn: Function) => void;
  export const test: (name: string, fn: Function) => void;
  export const before: (fn: Function) => void;
  export const after: (fn: Function) => void;
  export const beforeEach: (fn: Function) => void;
  export const afterEach: (fn: Function) => void;

  export const mock: {
    fn: <T extends (...args: any[]) => any>(
      implementation?: T,
    ) => jest.Mock<ReturnType<T>, Parameters<T>>;
    method: <T extends object, K extends keyof T>(
      object: T,
      methodName: K,
      implementation?: (...args: any[]) => any,
    ) => jest.Mock;
    getter: <T extends object, K extends keyof T>(
      object: T,
      propName: K,
      value?: any,
    ) => void;
    setter: <T extends object, K extends keyof T>(
      object: T,
      propName: K,
      implementation?: (value: any) => void,
    ) => jest.Mock;
    reset: () => void;
  };
}

// Declare jest mock type for compatibility
declare namespace jest {
  interface Mock<T = any, Y extends any[] = any[]> {
    (...args: Y): T;
    mock: {
      calls: { arguments: Y }[];
      results: any[];
      instances: any[];
      contexts: any[];
      lastCall: Y;
    };
    mockReturnValue: (value: T) => this;
    mockReturnValueOnce: (value: T) => this;
    mockResolvedValue: (value: T) => this;
    mockResolvedValueOnce: (value: T) => this;
    mockRejectedValue: (value: any) => this;
    mockRejectedValueOnce: (value: any) => this;
    mockImplementation: (fn: (...args: Y) => T) => this;
    mockImplementationOnce: (fn: (...args: Y) => T) => this;
  }
}
