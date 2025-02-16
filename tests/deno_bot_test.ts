#!/usr/bin/env -S deno run --unstable --allow-all
import { Pty } from "https://deno.land/x/deno_pty_ffi@0.16.0/mod.ts";
import { stripAnsiCode } from "https://deno.land/std@0.204.0/fmt/colors.ts";
import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.204.0/assert/mod.ts";

const ENCODER = new TextEncoder();

if (import.meta.main) {
  const pty = new Pty({
    cmd: "cargo",
    args: ["run", "--", "--default-config"],
    env: [["NO_COLOR", "1"]],
  });

  while (true) {
    let input = await pty.read();
    if (input === undefined) break;
    input = stripAnsiCode(input);

    if (input.includes("In:")) break;
    await sleep(100);
  }

  const write = async (input: string) => await pty.write(input + "\n\r");
  const evalRs = async (input: string) => {
    await write(input);
    // detect output
    // the plan is:
    // In: ...
    // ... // we want his line
    // ... // and this line
    // In: ...
    // The output is all the part between 2 `In:`
    //
    // Should not be used with input that gives empty output
    // like rust statements
    let out = "";
    let end_detect = 0;
    while (true) {
      let o = await pty.read();
      if (o === undefined) break;
      o = stripAnsiCode(o);
      if (!o.startsWith("In:")) {
        end_detect += 1;
        out += o;
      } else if (end_detect >= 1 && o.startsWith("In:")) {
        break;
      } else {
        end_detect = 0;
      }
      await sleep(100);
    }
    const result = out!.replace(/^Out:/, "").trim();
    return result;
  };

  const test = async (
    input: string,
    expected: string | RegExp,
  ) => {
    Deno.stdout.write(ENCODER.encode("eval: " + input));
    const output = await evalRs(input);
    // try catch just to add a new line before the error
    try {
      if (typeof expected == "string") {
        assertEquals(
          output,
          expected,
        );
      } // exepected is a regex
      else {
        assertMatch(output, expected);
      }
    } catch (e) {
      console.log();
      throw e;
    }
    console.log(" [OK]");
  };

  await write('let a = "hello";');
  await test(":type a", "`&str`");

  await write(`fn fact(n: usize) -> usize {
      match n {
        1 => 1,
        n => n * fact(n-1)
      }
  }`);
  await test("fact(4)", "24");

  await test("5+4", "9");
  await test("z", /cannot find value `z`/);
  await test("let a = 2; a + a", "4");
  // NOTE: this requires network, is it a good idea to enable it ?
  // await evalRs(":add regex");
  // await test('regex::Regex::new("a.*a")', 'Ok(Regex("a.*a"))');
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}
