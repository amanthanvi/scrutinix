import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyzerRuntimeProvider } from "@/components/scrutinix/analyzer-runtime";
import { ANSWER_PAUSE_MS } from "@/components/scrutinix/input-anatomy";
import { ScanForm } from "@/components/scrutinix/scan-form";
import {
  announce,
  ANNOUNCEMENT_MS,
  Announcer,
} from "@/components/ui/announcer";
import {
  spokenText,
  spokenTextNodes,
  visibleText,
} from "@/tests/dom/helpers/speech";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function renderForm() {
  return render(
    <AnalyzerRuntimeProvider shared={null}>
      <ScanForm />
      <Announcer />
    </AnalyzerRuntimeProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  announce("");
});

function linkLine() {
  const line = document.getElementById("sx-input-anatomy");
  if (!line) throw new Error("no captioned link");
  return line;
}

function typeLink(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "URL to analyze" }), {
    target: { value },
  });
}

const OWNER = "This link belongs to secure-login.xyz, not paypal.com.";

describe("the link, taken apart on paste", () => {
  it("shows nothing until the field holds a web link", () => {
    renderForm();
    typeLink("not a link");
    expect(
      screen.queryByRole("region", { name: "The link, taken apart" }),
    ).toBeNull();
  });

  it("names each part and states a look-alike before any scan", async () => {
    renderForm();
    typeLink("https://paypal.com.secure-login.xyz/verify");

    const region = await screen.findByRole("region", {
      name: "The link, taken apart",
    });
    // Each part is spoken after its name; the visual captions are hidden
    // from assistive technology so nothing is read twice.
    expect(spokenText(linkLine())).toBe(
      "https://,\u00a0A label anyone can add: paypal.com.,\u00a0Registered domain: secure-login.xyz,\u00a0A page on that domain: /verify",
    );
    expect(region.textContent).toContain(OWNER);
  });

  it("speaks each named part as one string, and has no title to speak instead", async () => {
    renderForm();
    typeLink("https://paypal.com.secure-login.xyz/verify");
    await screen.findByRole("region", { name: "The link, taken apart" });

    // Chrome on Android read a title as the line's whole text, so TalkBack
    // spoke the bare link and never the part names.
    expect(linkLine().hasAttribute("title")).toBe(false);
    expect(document.querySelector("#scan-console [title]")).toBeNull();
    // A part's name and text in one string: the drawn text is split into
    // boxes that would read as separate stops. Each opens with a comma and
    // a no-break space (an ordinary one is dropped at the edge of the
    // sr-only box), so TalkBack, which reads the line as one string, keeps
    // the parts apart.
    expect(spokenTextNodes(linkLine())).toEqual([
      "https://",
      ",\u00a0A label anyone can add: paypal.com.",
      ",\u00a0Registered domain: secure-login.xyz",
      ",\u00a0A page on that domain: /verify",
    ]);
    // The eye still reads the link as written, each part captioned.
    expect(visibleText(linkLine())).toBe(
      "https://paypal.com.A label anyone can addsecure-login.xyzRegistered domain/verifyA page on that domain",
    );
  });

  it("says the owner sentence as one string, drawn with its domains set apart", async () => {
    renderForm();
    typeLink("https://paypal.com.secure-login.xyz/verify");
    const region = await screen.findByRole("region", {
      name: "The link, taken apart",
    });
    const sentence = region.querySelector("p.sx-owner");
    if (!sentence) throw new Error("no owner sentence");
    // Each domain is its own inline box (kept whole where it fits), which
    // TalkBack and VoiceOver read as four stops; they get one string.
    expect(spokenTextNodes(sentence)).toEqual([OWNER]);
    expect(visibleText(sentence)).toBe(OWNER);
    expect(sentence.querySelector(".font-mono.font-bold")?.textContent).toBe(
      "secure-login.xyz",
    );
  });

  it("lets a long path wrap after the slashes that follow a name", async () => {
    renderForm();
    typeLink(`https://example.com/verify${"/".repeat(30)}step/now`);
    await screen.findByRole("region", { name: "The link, taken apart" });
    const path = linkLine().querySelector(
      ".sx-anat-part:last-child .sx-anat-text > span",
    );
    if (!path) throw new Error("no path part");
    // A line may end after "/verify////…/" and "step/", never inside
    // "verify", and the leading "/" never stands alone. A segment wider
    // than the line still breaks anywhere rather than overflow.
    expect(
      Array.from(path.childNodes).map((node) =>
        node.nodeType === Node.TEXT_NODE ? node.textContent : node.nodeName,
      ),
    ).toEqual([`/verify${"/".repeat(30)}`, "WBR", "step/", "WBR", "now"]);
    expect(path.className).toContain("wrap-anywhere");
    expect(path.className).not.toContain("break-all");
  });

  it("tells a screen reader which part is the registered domain on any link", async () => {
    renderForm();
    typeLink("https://accounts.example.com/login");
    await screen.findByRole("region", { name: "The link, taken apart" });
    expect(spokenText(linkLine())).toContain("Registered domain: example.com");
  });

  it("keeps a fragment route in the page part", async () => {
    renderForm();
    typeLink("https://example.com/#/login");
    await screen.findByRole("region", { name: "The link, taken apart" });
    expect(spokenText(linkLine())).toContain("A page on that domain: /#/login");
  });

  it("answers 'Expecting a particular site?' instantly", async () => {
    renderForm();
    typeLink("https://paypal.com.secure-login.xyz/verify");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Expecting a particular site?",
      }),
    );

    const expected = screen.getByRole("textbox", {
      name: "Which site were you expecting?",
    });
    expect(document.activeElement).toBe(expected);

    // A name is never confirmed or denied.
    fireEvent.change(expected, { target: { value: "PayPal" } });
    expect(
      screen.getByText(
        "We can't tell from a name whether secure-login.xyz is PayPal's site. Type its address to compare.",
      ),
    ).toBeTruthy();

    // The site the link spells out: the owner is stated once, above.
    fireEvent.change(expected, { target: { value: "paypal.com" } });
    expect(
      screen.getByText("No. The link only spells out paypal.com."),
    ).toBeTruthy();
    const region = screen.getByRole("region", {
      name: "The link, taken apart",
    });
    expect(spokenText(region).split(OWNER)).toHaveLength(2);
    expect(visibleText(region).split(OWNER)).toHaveLength(2);

    // Another site: answered, and the owner still stated once.
    fireEvent.change(expected, { target: { value: "google.com" } });
    expect(
      screen.getByText("No. This link doesn't belong to google.com."),
    ).toBeTruthy();
    expect(spokenText(region).match(/This link belongs to/g)).toHaveLength(1);

    fireEvent.change(expected, { target: { value: "secure-login.xyz" } });
    expect(screen.getByText("Matches secure-login.xyz.")).toBeTruthy();
  });

  it("speaks the expected-site answer once typing pauses, not on every keystroke", async () => {
    renderForm();
    typeLink("https://paypal.com.secure-login.xyz/verify");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Expecting a particular site?",
      }),
    );
    const expected = screen.getByRole("textbox", {
      name: "Which site were you expecting?",
    });
    const status = screen.getByRole("status");
    vi.useFakeTimers();

    for (const typed of ["p", "pa", "paypal.c", "paypal.co", "paypal.com"]) {
      fireEvent.change(expected, { target: { value: typed } });
      act(() => {
        vi.advanceTimersByTime(ANSWER_PAUSE_MS / 2);
      });
    }
    // The answer shows at once, but has no live region of its own.
    const answer = screen.getByText("No. The link only spells out paypal.com.");
    expect(answer.closest("[aria-live], [role='status']")).toBeNull();
    expect(status.textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(ANSWER_PAUSE_MS);
    });
    expect(status.textContent).toBe("No. The link only spells out paypal.com.");
  });

  it("waits out a screen-reader typist's pace (about a key a second)", async () => {
    renderForm();
    typeLink("https://paypal.com.secure-login.xyz/verify");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Expecting a particular site?",
      }),
    );
    const expected = screen.getByRole("textbox", {
      name: "Which site were you expecting?",
    });
    const status = screen.getByRole("status");
    vi.useFakeTimers();

    // At 700 ms VoiceOver queued an answer for every partial name and
    // TalkBack began each one.
    for (const typed of ["p", "pa", "pay", "paypal.c", "paypal.co"]) {
      fireEvent.change(expected, { target: { value: typed } });
      act(() => {
        vi.advanceTimersByTime(1_150);
      });
      expect(status.textContent).toBe("");
    }
    fireEvent.change(expected, { target: { value: "paypal.com" } });
    act(() => {
      vi.advanceTimersByTime(ANSWER_PAUSE_MS + 100);
    });
    expect(status.textContent).toBe("No. The link only spells out paypal.com.");
  });

  it("says the answer at once on Enter or on leaving the field, and only once", async () => {
    renderForm();
    typeLink("https://paypal.com.secure-login.xyz/verify");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Expecting a particular site?",
      }),
    );
    const expected = screen.getByRole("textbox", {
      name: "Which site were you expecting?",
    });
    const status = screen.getByRole("status");
    vi.useFakeTimers();

    fireEvent.change(expected, { target: { value: "paypal.com" } });
    fireEvent.keyDown(expected, { key: "Enter" });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(status.textContent).toBe("No. The link only spells out paypal.com.");
    // The pause that follows doesn't say it again: the region empties when
    // the Enter announcement's time is up (a repeat would hold it longer).
    act(() => {
      vi.advanceTimersByTime(ANNOUNCEMENT_MS);
    });
    expect(status.textContent).toBe("");

    fireEvent.change(expected, { target: { value: "google.com" } });
    fireEvent.blur(expected);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(status.textContent).toBe(
      "No. This link doesn't belong to google.com.",
    );
  });
});

vi.mock("@/components/ui/lazy-toaster", () => ({
  getToast: async () => (await import("sonner")).toast,
}));
