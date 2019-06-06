#!/usr/bin/env node

import { basename, join } from "path";
import { spawnSync } from "child_process";

type Architecture = "arm" | "arm64" | "ia32" | "ppc" | "ppc64" | "s390" | "s390x" | "x32" | "x64";
type Shell = "sh" | "bash" | "dash" | "zsh" | "fish" | "tcsh" | "ksh" | "mksh" | "cmd" | "ps";

const $panic = (fn: Function): any => {
    try {
        return fn();
    } catch (err) {
        console.error(`${err.name}${err.env_var ? " (" + err.env_var + ")" : ""}: ${err.message}`);
        process.exit(1);
    }
};

const $get = (obj: Record<string, any>, path: string): any => path.split(".").reduce((o: any, key: string): any => o ? o[key] : undefined, obj);

const $contain = (obj: string | string[], element: any): boolean => {
    if (obj === undefined)
        return true;
    else if (Array.isArray(obj))
        return obj.includes(element);
    else return obj === element;
};

const $prettify = (o: any): string => `${o.os ? "os: " + o.os + "  " : ""}${o.arch ? "arch: " + o.arch + "  " : ""}${o.shell ? "shell:" + o.shell : ""}`;

interface NPMConfigARGV {
    remain: string[];
    cooked: string[];
    original: string[];
}

interface PackageJSON extends JSON {
    readonly [Symbol.toStringTag]: string;
    readonly scripts?: JSON;
    readonly pkgscript?: JSON;
    readonly posixlike?: boolean;
}

interface Script {
    os?: string[] | string;
    arch?: string[] | string;
    shell?: string[] | string;
    posixlike?: boolean;
    script: string;
}

class NPMEnvironmentVariableNotFoundException extends Error {
    public env_var: string;
    public constructor(name: string, env_var: string, ...args: any[]) {
        super(...args);

        this.name = name;
        this.env_var = env_var;
    }
}

class Environment {
    public static os(): NodeJS.Platform {
        return process.platform;
    }

    public static is_windows(): boolean {
        return process.platform === "win32";
    }

    public static is_windows_bash(): boolean {
        return this.is_windows() && (/^MINGW(32|64)$/.test(process.env.MSYSTEM) || process.env.TERM === "cygwin");
    }

    public static is_windows_shell(): boolean {
        return this.is_windows() && !this.is_windows_bash();
    }

    public static arch(): Architecture | string {
        return process.arch;
    }

    public static script_shell(): Shell | string {
        let script_shell = process.env.npm_config_script_shell;

        return basename(script_shell).replace(".exe", "") || (this.is_windows() ? "cmd" : "sh");
    }

    public static script_shell_full(): Shell | string {
        let script_shell = process.env.npm_config_script_shell;
        return script_shell || (this.is_windows() ? (process.env.comspec || "cmd.exe") : "sh");
    }


    public static is_unix(): boolean {
        return ["android", "darwin", "freebsd", "linux", "openbsd", "sunos"].includes(this.os());
    }

    public static argv(): string[] | NPMEnvironmentVariableNotFoundException {
        if (!process.env.npm_config_argv) throw new NPMEnvironmentVariableNotFoundException("ArgumentsNotFoundError", "npm_config_argv", "Execution from outside of package manager is not allowed.");

        const argv: NPMConfigARGV = JSON.parse(process.env.npm_config_argv);
        if (argv.cooked[0] !== "run" && argv.cooked[0] !== "run-script") argv.cooked.unshift("run");

        return argv.cooked;
    }
}

class Package {
    private config: PackageJSON;
    private posixlike: boolean;

    public constructor() {
        this.config = require(join(process.cwd(), "package.json"));
        this.posixlike = this.get_pkgscipt_posixlike();
    }

    private get_pkgscipt_posixlike(): boolean {
        let isposixlike = $get(this.config, "pkgscript.posixlike");
        return isposixlike !== undefined;
    }

    public is_posixlike(): boolean {
        return this.posixlike;
    }

    public available_scripts(arg: string): Script[] | Error {
        const scripts: Script[] = $get(this.config, `pkgscript.scripts.${arg}`);
        if (scripts === undefined) throw new Error(`No script defined for ${arg}`);

        const current_os = Environment.os();
        const current_arch = Environment.arch();
        const default_shell = Environment.script_shell();

        const matched_scripts: Script[] = [];
        if (Array.isArray(scripts)) {
            for (let index = 0; index < scripts.length; index++) {
                const is_unix = scripts[index].os === "unix" && Environment.is_unix();
                const is_posixlike_toplevel = $get(this.config, "pkgscript.posixlike");
                const is_posixlike_scriptlevel = scripts[index].posixlike;
                const is_posixlike = is_posixlike_scriptlevel === undefined ? (is_posixlike_toplevel === undefined ? undefined : is_posixlike_toplevel) : is_posixlike_scriptlevel;
                const platform_is_ok = $contain(scripts[index].os, current_os) || is_unix;
                const arch_is_ok = $contain(scripts[index].arch, current_arch);
                const shell_is_ok = $contain(scripts[index].shell, default_shell);

                if (platform_is_ok && arch_is_ok && shell_is_ok && (is_posixlike === true ? Environment.is_windows_bash() : true))
                    matched_scripts.push(scripts[index]);
            }
            return matched_scripts;
        } else {
            throw new Error(`Expected array but found ${typeof scripts}.`);
        }
    }
}

class PkgScript {
    private pkg: Package;
    private args: any;

    public constructor() {
        this.pkg = new Package();
        this.args = $panic((): any => Environment.argv());
    }

    public launch(): void {
        const script_name = this.args[1];
        const scripts: Script[] = $panic((): any => this.pkg.available_scripts(script_name));
        this.run_scripts(scripts);
    }

    private run_scripts(scripts: Script[]): any {
        scripts.forEach((script): void => {
            console.log(`> ${this.args[1]} ${$prettify(script)}`);
            let sh = $panic((): any => Environment.script_shell_full());
            let shFlag = "-c";

            if (Environment.is_windows()) {
                shFlag = "/d /s /c";
            }

            spawnSync(sh, [shFlag, script.script], {
                cwd: process.cwd(),
                stdio: "inherit",
                windowsVerbatimArguments: Environment.is_windows()
            });
            console.log("");
        });
    }
}

const app = new PkgScript();
app.launch();