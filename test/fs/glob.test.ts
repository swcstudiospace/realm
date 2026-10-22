import { test } from "node:test";
import assert from "node:assert/strict";
import { matchGlob } from "../../src/fs/glob.js";

// Matcher cases for D-32: a local matcher with no dependency. Each expected answer is a
// literal, so the test does not read the matcher under test.

void test("star matches any run of characters inside one segment (D-32)", () => {
  assert.equal(matchGlob("*.txt", "notes.txt"), true);
  assert.equal(matchGlob("*.txt", ".txt"), true);
  assert.equal(matchGlob("a*c", "abbc"), true);
  assert.equal(matchGlob("a*c", "ac"), true);
  assert.equal(matchGlob("*.txt", "dir/notes.txt"), false);
  assert.equal(matchGlob("a*c", "a/c"), false);
});

void test("star backtracks across several wildcards (D-32)", () => {
  assert.equal(matchGlob("*a*b", "xaxab"), true);
  assert.equal(matchGlob("*a*b", "xaxa"), false);
});

void test("question mark matches exactly one character and never a separator (D-32)", () => {
  assert.equal(matchGlob("file?.log", "file1.log"), true);
  assert.equal(matchGlob("file?.log", "file.log"), false);
  assert.equal(matchGlob("file?.log", "file12.log"), false);
  assert.equal(matchGlob("a?b", "a/b"), false);
});

void test("double star matches zero or more whole segments at the root (D-32)", () => {
  assert.equal(matchGlob("**/id_rsa", "id_rsa"), true);
  assert.equal(matchGlob("**/id_rsa", "keys/id_rsa"), true);
  assert.equal(matchGlob("**/id_rsa", "a/b/c/id_rsa"), true);
  assert.equal(matchGlob("**/id_rsa", "a/id_rsa2"), false);
  assert.equal(matchGlob("**/id_rsa", "id_rsa/a"), false);
});

void test("double star matches zero or more whole segments in the middle (D-32)", () => {
  assert.equal(matchGlob("a/**/z", "a/z"), true);
  assert.equal(matchGlob("a/**/z", "a/b/z"), true);
  assert.equal(matchGlob("a/**/z", "a/b/c/z"), true);
  assert.equal(matchGlob("a/**/z", "b/z"), false);
  assert.equal(matchGlob("a/**/z", "a/z/q"), false);
});

void test("double star matches zero or more whole segments at the end (D-32)", () => {
  assert.equal(matchGlob("a/**", "a"), true);
  assert.equal(matchGlob("a/**", "a/b"), true);
  assert.equal(matchGlob("a/**", "a/b/c"), true);
  assert.equal(matchGlob("a/**", "b/a"), false);
});

void test("several double stars and a lone double star (D-32)", () => {
  assert.equal(matchGlob("**/a/**/b", "a/b"), true);
  assert.equal(matchGlob("**/a/**/b", "x/a/y/z/b"), true);
  assert.equal(matchGlob("**/a/**/b", "x/b"), false);
  assert.equal(matchGlob("**", "any/thing/at/all"), true);
});

void test("a literal dot is not a wildcard and a segment never matches a prefix (D-32)", () => {
  assert.equal(matchGlob(".env", "xenv"), false);
  assert.equal(matchGlob(".env", ".env.local"), false);
  assert.equal(matchGlob(".env.*", ".env"), false);
  assert.equal(matchGlob(".env.*", ".env.local"), true);
});
