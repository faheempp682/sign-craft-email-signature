import Link from "next/link";
import { getBrand } from "@/lib/brand";
import { PRESETS, getPreset } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { claimText } from "@/lib/site/claims";
import { NICHES } from "@/lib/site/niches";
import { faqLd, organizationLd, softwareApplicationLd, type FaqItem } from "@/lib/site/seo";
import { CheckCircleIcon } from "@solar-icons/react/bold-duotone/check-circle";
import { ArrowRightIcon } from "@solar-icons/react/bold-duotone/arrow-right";
import { SignatureFrame } from "./signature-frame";
import { CtaBand, Faq, JsonLd, PreviewShell, Section } from "./ui";

export const HOME_TITLE = "Free email signature generator";
export const HOME_DESCRIPTION = "Design a professional email signature in your browser. Pick from over a hundred templates, copy it into your mail app, no account needed.";

function homeFaq(name: string): FaqItem[] {
  return [
    { q: "Is the signature generator really free?", a: "Yes. The generator runs in your browser, needs no account and has no usage fee. Saving signatures, AI autofill and team features need an account." },
    { q: "Do you store what I type into the generator?", a: "No. The free generator is fully client-side: nothing you enter is sent to a server, and no files are uploaded." },
    { q: "How do I add the signature to my mail app?", a: "Copy it as rich text and paste it into your mail app's signature settings, or download the .htm file. Mail apps differ in what they accept, so send yourself a test message and look at it." },
    { q: "Will it look the same in every mail app?", a: `No tool can promise that. ${claimText("outlookRendering")} ${claimText("gmailRendering")} We have not yet verified every client, so test before you roll a signature out to a team.` },
    { q: `What is the difference between the free generator and a ${name} account?`, a: "The generator makes one signature at a time and keeps nothing. An account adds saving and editing, AI autofill from pasted text or a website, a wider editor, and tools for teams." },
  ];
}

export function MarketingHome() {
  const brand = getBrand();
  const hero = getPreset("studio-009") ?? PRESETS[0];
  const heroHtml = renderToEmailHtml(hero.doc);
  const faq = homeFaq(brand.name);
  const total = PRESETS.length;

  return (
    <>
      <JsonLd data={organizationLd(brand)} />
      <JsonLd data={softwareApplicationLd({ description: HOME_DESCRIPTION, brand })} />
      <JsonLd data={faqLd(faq)} />

      <div className="grid-bg">
        <section className="mx-auto grid w-full max-w-5xl gap-10 px-4 pb-12 pt-12 md:grid-cols-2 md:items-center md:pb-20 md:pt-20">
          <div>
            <p className="eyebrow mb-3">Free email signature generator</p>
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight md:text-5xl">A better email signature in about two minutes.</h1>
            <p className="mt-5 max-w-prose text-lg leading-relaxed text-muted">
              Choose from {total} designs, add your details, and copy it into your mail app. {claimText("outlookRendering")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/signature-generator" className="btn btn-primary">
                Make a free signature
                <ArrowRightIcon className="size-4" aria-hidden />
              </Link>
              <Link href="/login" className="btn">
                Sign in to save
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted">No account needed. It runs in your browser and nothing you type is uploaded.</p>
          </div>
          <PreviewShell caption="Example design. Names and details are sample text.">
            <SignatureFrame html={heroHtml} title={`Example signature: ${hero.name}`} minHeight={170} />
          </PreviewShell>
        </section>
      </div>

      <Section eyebrow="How it works" title="Three steps, nothing to install">
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            { n: "1", t: "Pick a design", d: `Browse a curated set of designs, from plain text to card layouts. All of them are built from the same email-safe parts.` },
            { n: "2", t: "Add your details", d: "Name, role, phone, email, website, social links and an accent colour. The preview updates as you type." },
            { n: "3", t: "Copy it into your mail app", d: "Copy as rich text, or download an .htm file. Then paste it into your mail app's signature box." },
          ].map((s) => (
            <li key={s.n} className="card p-5">
              <span className="eyebrow">Step {s.n}</span>
              <h3 className="mt-2 font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="Built for mail apps" title="Why most signatures fall apart, and what we do differently">
        <div className="grid gap-8 md:grid-cols-2">
          <p className="leading-relaxed text-muted">
            Mail apps are not browsers. Many ignore modern layout CSS, strip scripts and fonts, and block remote images until you click. A signature designed like a web page is the one that arrives with columns stacked on top of each other.
          </p>
          <ul className="space-y-3">
            {[
              "Layout uses plain tables, the one structure every mail app understands",
              "All styling is inline, with no style blocks, flexbox, grid or background images",
              "Fonts are limited to ones installed almost everywhere",
              "Images must be https links, and your name and contact details stay as real text",
              "No scripts, no tracking pixels in the free generator",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                <span className="text-sm leading-relaxed">{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-6 text-sm text-muted">These are design rules, not test results. We are still testing in real Gmail and Outlook accounts, and this site will say so until that is done.</p>
      </Section>

      <Section eyebrow="Free and account" title="Start free. Sign in when you want more.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <h3 className="text-lg font-semibold">Free generator</h3>
            <p className="mt-1 text-sm text-muted">No account. Fully in your browser.</p>
            <ul className="mt-4 space-y-2 text-sm">
              {["Curated template library", "Your details and accent colour", "Live preview", "Copy as rich text or download .htm"].map((t) => (
                <li key={t} className="flex gap-2">
                  <CheckCircleIcon className="size-5 shrink-0 text-brand" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
            <Link href="/signature-generator" className="btn btn-primary mt-6">
              Open the generator
            </Link>
          </div>
          <div className="card p-6">
            <h3 className="text-lg font-semibold">With an account</h3>
            <p className="mt-1 text-sm text-muted">For people and teams who keep a signature up to date.</p>
            <ul className="mt-4 space-y-2 text-sm">
              {["Save and edit signatures", "AI autofill from pasted text or a website", "Image uploads and the full editor", "Team features for agencies", claimText("gmailPush")].map((t) => (
                <li key={t} className="flex gap-2">
                  <CheckCircleIcon className="size-5 shrink-0 text-brand" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
            <Link href="/login" className="btn mt-6">
              Sign in
            </Link>
          </div>
        </div>
      </Section>

      <Section eyebrow="By profession" title="Signatures written for the way you work">
        <div className="grid gap-4 sm:grid-cols-2">
          {NICHES.map((n) => (
            <Link key={n.slug} href={`/for/${n.slug}`} className="card group p-5 transition-colors hover:bg-surface-2">
              <h3 className="font-semibold">{n.label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{n.pains[0].title}.</p>
              <span className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium">
                Read the guide <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </Section>

      <Section eyebrow="Questions" title="Frequently asked questions">
        <Faq items={faq} />
      </Section>

      <CtaBand title="Make your signature now" body="It takes about two minutes and needs no account." primary={{ href: "/signature-generator", label: "Open the free generator" }} secondary={{ href: "/login", label: "Sign in" }} />
    </>
  );
}
