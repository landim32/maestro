import type { AntCli, AntLocation, LoginResult } from '../../src/setup/antCli.js';

export interface FakeAntScript {
  /** undefined → not installed */
  location?: AntLocation;
  /** Lines emitted while the login runs (a URL in a line is reported as `url`). */
  loginOutput?: string[];
  /** How the login ends unless the test resolves it manually. */
  loginResult?: LoginResult;
  /** When true the login stays pending until `finishLogin()` is called. */
  manual?: boolean;
  statusLoggedIn?: boolean;
  statusSummary?: string;
}

export interface FakeAnt extends AntCli {
  calls: Array<{ method: string; args: unknown[] }>;
  cancelled: number;
  finishLogin(result: LoginResult): void;
  setLoggedIn(v: boolean): void;
  setLocation(loc: AntLocation | undefined): void;
}

/** Scripted stand-in for the `ant` CLI (no processes spawned). */
export function fakeAntCli(script: FakeAntScript = {}): FakeAnt {
  let pendingResolve: ((r: LoginResult) => void) | undefined;
  let loggedIn = script.statusLoggedIn ?? false;
  let location = script.location;
  const fake: FakeAnt = {
    calls: [],
    cancelled: 0,
    locate() {
      fake.calls.push({ method: 'locate', args: [] });
      return location;
    },
    runLogin(antPath, opts) {
      fake.calls.push({ method: 'runLogin', args: [antPath] });
      const promise = new Promise<LoginResult>((resolve) => {
        pendingResolve = resolve;
        setTimeout(() => {
          for (const line of script.loginOutput ?? []) {
            opts.onOutput?.(line, /https?:\/\/\S+/.exec(line)?.[0]);
          }
          if (!script.manual) {
            const result = script.loginResult ?? {
              ok: true,
              summary: 'Logged in to Test Org as tester@example.com',
            };
            if (result.ok) loggedIn = true;
            resolve(result);
          }
        }, 5);
      });
      return {
        promise,
        cancel: () => {
          fake.cancelled++;
          pendingResolve?.({ ok: false, reason: 'cancelado', cancelled: true });
        },
      };
    },
    async readStatus(antPath) {
      fake.calls.push({ method: 'readStatus', args: [antPath] });
      return {
        loggedIn,
        summary: loggedIn
          ? (script.statusSummary ?? 'Logged in to Test Org as tester@example.com')
          : '(profile "default" not configured — run `ant auth login` to set it up)',
      };
    },
    finishLogin(result) {
      if (result.ok) loggedIn = true;
      pendingResolve?.(result);
    },
    setLoggedIn(v) {
      loggedIn = v;
    },
    setLocation(loc) {
      location = loc;
    },
  };
  return fake;
}
