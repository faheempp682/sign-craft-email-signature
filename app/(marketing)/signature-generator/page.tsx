import { getBrand } from "@/lib/brand";
import { claimText } from "@/lib/site/claims";
import { faqLd, organizationLd, pageMetadata, softwareApplicationLd } from "@/lib/site/seo";
import { JsonLd, Section } from "../ui";
import { SignatureGenerator } from "./generator";

const TITLE = "Free email signature generator";
const DESCRIPTION = "Make an email signature online for free. Pick a template, add your details, preview it live and copy it into your mail app. No account, no upload, runs in your browser.";

export function generateMetadata() {
  return pageMetadata({ path: "/signature-generator", title: TITLE, description: DESCRIPTION });
}

const FAQ = [
  { q: "Does this send my details anywhere?", a: "No. The generator runs entirely in your browser. What you type is not sent to a server, nothing is uploaded, and no AI is involved. Closing the tab clears it." },
  { q: "How do I use the signature once I have made it?", a: "Press Copy signature and paste it into your mail app's signature settings, or download the .htm file. Send yourself a test message to check it." },
  { q: "Why can I not upload a logo or photo here?", a: "To keep this page free of any server-side surface, uploads are an account feature. You can link to an image that is already online at an https:// address." },
  { q: "Will it look identical in every mail app?", a: `No tool can promise that. ${claimText("outlookRendering")} We have not yet verified every client, so always test.` },
];

export default function GeneratorPage() {
  const brand = getBrand();
  return (
    <>
      <JsonLd data={organizationLd(brand)} />
      <JsonLd data={softwareApplicationLd({ description: DESCRIPTION, free: true, brand, path: "/signature-generator" })} />
      <JsonLd data={faqLd(FAQ)} />
      <div className="mx-auto w-full max-w-5xl px-4 pb-8 pt-10 md:pt-14">
        <p className="eyebrow mb-2">Free, no account</p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">Free email signature generator</h1>
        <p className="mt-3 max-w-2xl text-muted">Fill in your details and watch the signature update. It is built from plain tables and inline styles, the way mail apps expect. Nothing leaves your browser.</p>
        <div className="mt-8">
          <SignatureGenerator />
        </div>
      </div>
      <Section eyebrow="Questions" title="About the generator">
        <div className="grid max-w-3xl gap-6">
          {FAQ.map((f) => (
            <div key={f.q}>
              <h3 className="font-semibold">{f.q}</h3>
              <p className="mt-1 leading-relaxed text-muted">{f.a}</p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
