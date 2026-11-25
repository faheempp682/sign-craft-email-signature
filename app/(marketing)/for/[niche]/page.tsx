import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrand } from "@/lib/brand";
import { getPreset } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { NICHES, getNiche } from "@/lib/site/niches";
import { faqLd, organizationLd, pageMetadata } from "@/lib/site/seo";
import { ArrowRightIcon } from "@solar-icons/react/bold-duotone/arrow-right";
import { CheckCircleIcon } from "@solar-icons/react/bold-duotone/check-circle";
import { SignatureFrame } from "../../signature-frame";
import { CtaBand, Faq, JsonLd, PreviewShell, Section } from "../../ui";

type Params = { niche: string };

export function generateStaticParams(): Params[] {
  return NICHES.map((n) => ({ niche: n.slug }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const n = getNiche((await params).niche);
  if (!n) return {};
  return pageMetadata({ path: `/for/${n.slug}`, title: n.metaTitle, description: n.metaDescription });
}

export default async function NichePage({ params }: { params: Promise<Params> }) {
  const n = getNiche((await params).niche);
  if (!n) notFound();
  const brand = getBrand();
  const preset = getPreset(n.presetId);
  const others = NICHES.filter((o) => o.slug !== n.slug);

  return (
    <>
      <JsonLd data={organizationLd(brand)} />
      <JsonLd data={faqLd(n.faq)} />

      <section className="mx-auto grid w-full max-w-5xl gap-10 px-4 pb-8 pt-12 md:grid-cols-2 md:items-center md:pt-16">
        <div>
          <p className="eyebrow mb-3">For {n.label.toLowerCase()}</p>
          <h1 className="text-3xl font-semibold leading-[1.1] tracking-tight md:text-4xl">{n.h1}</h1>
          <p className="mt-5 leading-relaxed text-muted">{n.lead}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/signature-generator" className="btn btn-primary">
              Make my signature
              <ArrowRightIcon className="size-4" aria-hidden />
            </Link>
            <Link href="/login" className="btn">
              Sign in to save
            </Link>
          </div>
        </div>
        {preset && (
          <PreviewShell caption={n.presetCaption}>
            <SignatureFrame html={renderToEmailHtml(preset.doc)} title={`Example for ${n.label.toLowerCase()}: ${preset.name}`} minHeight={170} />
          </PreviewShell>
        )}
      </section>

      <Section title={n.painsHeading}>
        <div className="grid gap-4 md:grid-cols-2">
          {n.pains.map((p) => (
            <div key={p.title} className="card p-5">
              <h3 className="font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={n.includeHeading}>
        <ul className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {n.include.map((i) => (
            <li key={i.title} className="flex gap-3">
              <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
              <div>
                <p className="font-medium">{i.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{i.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={n.mistakesHeading}>
        <ul className="max-w-3xl list-disc space-y-3 pl-5 marker:text-muted">
          {n.mistakes.map((m) => (
            <li key={m} className="leading-relaxed">
              {m}
            </li>
          ))}
        </ul>
      </Section>

      <Section eyebrow="FAQ" title={`Questions from ${n.label.toLowerCase()}`}>
        <Faq items={n.faq} />
      </Section>

      <CtaBand title={n.ctaHeading} body={n.ctaBody} primary={{ href: "/signature-generator", label: "Open the free generator" }} secondary={{ href: "/login", label: "Sign in" }} />

      <nav aria-label="Other guides" className="mx-auto w-full max-w-5xl px-4 pb-16">
        <p className="text-sm text-muted">
          Also see:{" "}
          {others.map((o, i) => (
            <span key={o.slug}>
              {i > 0 && ", "}
              <Link href={`/for/${o.slug}`} className="underline underline-offset-2">
                {o.label}
              </Link>
            </span>
          ))}
        </p>
      </nav>
    </>
  );
}
