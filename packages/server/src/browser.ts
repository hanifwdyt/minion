import { chromium as chromiumVanilla, Browser, Page, BrowserContext, Cookie } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// rebrowser-patches must be applied as a CLI step (postinstall), not imported at runtime.
// Run: npx rebrowser-patches patch --packageName playwright-core

chromium.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = resolve(__dirname, "../data/browser-sessions");

if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });

export interface BrowserAction {
  type:
    | "navigate"
    | "click"
    | "fill"
    | "getText"
    | "getHtml"
    | "screenshot"
    | "evaluate"
    | "waitForSelector"
    | "scroll"
    | "select"
    | "hover"
    | "back"
    | "reload"
    | "press"
    | "wait"
    | "typeAt";
  x?: number;
  y?: number;
  selector?: string;
  value?: string;
  script?: string;
  url?: string;
  timeout?: number;
}

export interface LoginConfig {
  url: string;        // sign_in page URL
  email: string;
  password: string;
  emailSelector?: string;
  passwordSelector?: string;
  successUrl?: string; // URL substring to validate successful login
}

export interface BrowserResult {
  success: boolean;
  data?: any;
  error?: string;
  screenshotBase64?: string;
}

export interface ProxyConfig {
  server: string;   // "http://host:port" or "socks5://host:port"
  username?: string;
  password?: string;
}

export interface RunSessionResult {
  results: Array<{ action: BrowserAction; result: BrowserResult }>;
  finalScreenshot?: string;
  sessionRestored?: boolean;
  loginPerformed?: boolean;
  error?: string;
}

let sharedBrowser: Browser | null = null;
let sharedBrowserProxy: string | null = null;

async function getBrowser(proxy?: ProxyConfig): Promise<Browser> {
  const proxyKey = proxy?.server || null;
  // If proxy changed or browser disconnected, restart
  if (sharedBrowser && sharedBrowser.isConnected() && sharedBrowserProxy === proxyKey) {
    return sharedBrowser;
  }
  if (sharedBrowser) await sharedBrowser.close().catch(() => {});

  const launchOpts: any = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  };
  if (proxy) launchOpts.proxy = proxy;

  sharedBrowser = await chromium.launch(launchOpts) as unknown as Browser;
  sharedBrowserProxy = proxyKey;
  return sharedBrowser;
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

// --- Session persistence ---

function sessionPath(name: string): string {
  return resolve(SESSIONS_DIR, `${name}.json`);
}

function saveCookies(name: string, cookies: Cookie[]): void {
  writeFileSync(sessionPath(name), JSON.stringify(cookies, null, 2));
  console.log(`[browser] saved ${cookies.length} cookies for session "${name}"`);
}

function loadCookies(name: string): Cookie[] | null {
  const p = sessionPath(name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function clearCookies(name: string): void {
  const p = sessionPath(name);
  if (existsSync(p)) {
    writeFileSync(p, "[]");
    console.log(`[browser] cleared session "${name}"`);
  }
}

// --- Login helper ---

async function performLogin(page: Page, login: LoginConfig): Promise<boolean> {
  const emailSel = login.emailSelector || 'input[name="portal_user[email]"]';
  const passSel  = login.passwordSelector || 'input[name="portal_user[password]"]';

  await page.goto(login.url, { waitUntil: "domcontentloaded", timeout: 15000 });

  // Fill + submit in one evaluate call (fastest)
  await page.evaluate(
    ({ email, pass, esel, psel }: { email: string; pass: string; esel: string; psel: string }) => {
      const emailEl = document.querySelector(esel) as HTMLInputElement | null;
      const passEl  = document.querySelector(psel) as HTMLInputElement | null;
      if (emailEl) emailEl.value = email;
      if (passEl)  passEl.value  = pass;
      const form = document.querySelector("form");
      if (form) form.submit();
    },
    { email: login.email, pass: login.password, esel: emailSel, psel: passSel }
  );

  // Wait for navigation to complete
  try {
    await page.waitForURL((url) => !url.toString().includes("sign_in"), { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

// --- Main API ---

async function executeAction(page: Page, action: BrowserAction): Promise<BrowserResult> {
  const timeout = action.timeout || 10000;

  try {
    switch (action.type) {
      case "navigate": {
        if (!action.url) return { success: false, error: "url required" };
        try {
          await page.goto(action.url, { waitUntil: "domcontentloaded", timeout });
        } catch {
          // timeout on domcontentloaded is ok — page may still be usable
        }
        return { success: true, data: { url: page.url(), title: await page.title() } };
      }

      case "press": {
        if (!action.value) return { success: false, error: "value (key) required" };
        if (action.selector) {
          await page.locator(action.selector).waitFor({ timeout });
          await page.locator(action.selector).press(action.value);
        } else {
          await page.keyboard.press(action.value);
        }
        return { success: true };
      }

      case "wait": {
        const ms = action.timeout || 1000;
        await new Promise((r) => setTimeout(r, ms));
        return { success: true };
      }

      case "click": {
        if (!action.selector) return { success: false, error: "selector required" };
        await page.locator(action.selector).first().waitFor({ timeout });
        await page.locator(action.selector).first().click();
        return { success: true };
      }

      case "fill": {
        if (!action.selector) return { success: false, error: "selector required" };
        if (action.value === undefined) return { success: false, error: "value required" };
        await page.locator(action.selector).first().waitFor({ timeout });
        await page.locator(action.selector).first().fill(action.value);
        return { success: true };
      }

      case "getText": {
        if (!action.selector) {
          const text = await page.evaluate(() => (document.body as HTMLElement).innerText);
          return { success: true, data: text };
        }
        await page.waitForSelector(action.selector, { timeout });
        const text = await page.textContent(action.selector);
        return { success: true, data: text };
      }

      case "getHtml": {
        if (!action.selector) {
          const html = await page.content();
          return { success: true, data: html };
        }
        await page.waitForSelector(action.selector, { timeout });
        const html = await page.innerHTML(action.selector);
        return { success: true, data: html };
      }

      case "screenshot": {
        const buf = await page.screenshot({ type: "png", fullPage: false });
        return { success: true, screenshotBase64: buf.toString("base64") };
      }

      case "evaluate": {
        if (!action.script) return { success: false, error: "script required" };
        const result = await page.evaluate(action.script);
        return { success: true, data: result };
      }

      case "waitForSelector": {
        if (!action.selector) return { success: false, error: "selector required" };
        await page.waitForSelector(action.selector, { timeout });
        return { success: true };
      }

      case "scroll": {
        if (action.selector) {
          await page.evaluate(
            (sel) => document.querySelector(sel)?.scrollIntoView(),
            action.selector
          );
        } else {
          await page.evaluate(() => window.scrollBy(0, 500));
        }
        return { success: true };
      }

      case "select": {
        if (!action.selector) return { success: false, error: "selector required" };
        if (!action.value) return { success: false, error: "value required" };
        await page.waitForSelector(action.selector, { timeout });
        await page.selectOption(action.selector, action.value);
        return { success: true };
      }

      case "hover": {
        if (!action.selector) return { success: false, error: "selector required" };
        await page.waitForSelector(action.selector, { timeout });
        await page.hover(action.selector);
        return { success: true };
      }

      case "back": {
        await page.goBack({ timeout });
        return { success: true, data: { url: page.url() } };
      }

      case "reload": {
        await page.reload({ timeout });
        return { success: true, data: { url: page.url() } };
      }

      case "typeAt": {
        // Click at x,y coordinates then type — useful for shadow DOM or canvas-based inputs
        const x = action.x ?? 640;
        const y = action.y ?? 400;
        await page.mouse.click(x, y);
        await new Promise((r) => setTimeout(r, 200));
        if (action.value) await page.keyboard.type(action.value, { delay: 80 });
        return { success: true };
      }

      default:
        return { success: false, error: `Unknown action type: ${(action as any).type}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function runBrowserSession(
  actions: BrowserAction[],
  options: {
    screenshot?: boolean;
    viewport?: { width: number; height: number };
    sessionName?: string;
    login?: LoginConfig;
    proxy?: ProxyConfig;    // residential/mobile proxy config
  } = {}
): Promise<RunSessionResult> {
  const browser = await getBrowser(options.proxy);
  const context: BrowserContext = await browser.newContext({
    viewport: options.viewport || { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  const results: Array<{ action: BrowserAction; result: BrowserResult }> = [];
  let sessionRestored = false;
  let loginPerformed  = false;

  try {
    // Restore saved cookies if sessionName given
    if (options.sessionName) {
      const saved = loadCookies(options.sessionName);
      if (saved && saved.length > 0) {
        await context.addCookies(saved);
        sessionRestored = true;
        console.log(`[browser] restored session "${options.sessionName}" (${saved.length} cookies)`);
      }
    }

    // If login config provided, navigate to a protected page first to validate session
    if (options.sessionName && options.login && sessionRestored) {
      const checkUrl = options.login.successUrl || options.login.url.replace("sign_in", "");
      await page.goto(checkUrl, { waitUntil: "domcontentloaded", timeout: 10000 });

      const currentUrl = page.url();
      const isInvalid  = currentUrl.includes("sign_in") || currentUrl.includes("login");

      if (isInvalid) {
        console.log(`[browser] session "${options.sessionName}" invalid, re-logging in...`);
        clearCookies(options.sessionName);
        sessionRestored = false;
        const ok = await performLogin(page, options.login);
        if (ok) {
          loginPerformed = true;
          const cookies = await context.cookies();
          saveCookies(options.sessionName, cookies);
        }
      }
    } else if (options.sessionName && options.login && !sessionRestored) {
      // No saved cookies — login fresh
      const ok = await performLogin(page, options.login);
      if (ok) {
        loginPerformed = true;
        const cookies = await context.cookies();
        saveCookies(options.sessionName, cookies);
      }
    }

    // Execute actions
    for (const action of actions) {
      const result = await executeAction(page, action);
      results.push({ action, result });
      if (!result.success && action.type !== "waitForSelector") {
        console.warn(`[browser] action ${action.type} failed: ${result.error}`);
      }
    }

    // Save cookies after actions (refresh session)
    if (options.sessionName) {
      const cookies = await context.cookies();
      if (cookies.length > 0) saveCookies(options.sessionName, cookies);
    }

    let finalScreenshot: string | undefined;
    if (options.screenshot) {
      const buf = await page.screenshot({ type: "png", fullPage: false });
      finalScreenshot = buf.toString("base64");
    }

    await context.close();
    return { results, finalScreenshot, sessionRestored, loginPerformed };
  } catch (err: any) {
    await context.close().catch(() => {});
    return { results, error: err.message, sessionRestored, loginPerformed };
  }
}
