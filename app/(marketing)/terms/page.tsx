import { getBrand } from "@/lib/brand";
import { PUBLIC_LIMITS } from "@/lib/site/rate-limit";
import { pageMetadata } from "@/lib/site/seo";
import { ContactLine, LegalDoc, Operator, Todo, type LegalSection } from "../legal";

export function generateMetadata() {
  return pageMetadata({ path: "/terms", title: "Terms of service", description: "The rules for using the service, including acceptable use, AI features, public usage limits and what we do and do not promise." });
}

export default function TermsPage() {
  const brand = getBrand();
  const read = PUBLIC_LIMITS.read;
  const sections: LegalSection[] = [
    {
      id: "agreement",
      title: "Agreement",
      body: (
        <p>
          These terms are between you and <Operator brand={brand} />, which operates {brand.name}. By using the website, the free generator or an account, you agree to them. If you use the service for an organisation, you confirm you may accept these terms for it. If you do not agree, do not use the service.
        </p>
      ),
    },
    {
      id: "service",
      title: "What the service is",
      body: (
        <>
          <p>{brand.name} helps you design email signatures and produce HTML you can paste into a mail app. It has two parts:</p>
          <ul>
            <li>
              <strong>The free generator</strong>, which needs no account and runs in your browser.
            </li>
            <li>
              <strong>Accounts</strong>, which add saving, the full editor, image uploads, AI features and, for some organisations, team and Google Workspace features. Access to accounts may be limited to invited people or approved email domains.
            </li>
          </ul>
          <p>Features may change, be limited, or be withdrawn. <Todo>Operator: describe plans and fees here once they exist; none are offered today</Todo></p>
        </>
      ),
    },
    {
      id: "accounts",
      title: "Your account",
      body: <p>Give accurate details, keep your sign-in secure, and tell us promptly if you think someone else has used your account. You are responsible for what is done through it.</p>,
    },
    {
      id: "use",
      title: "Acceptable use",
      body: (
        <>
          <p>You agree not to:</p>
          <ul>
            <li>use the service to deceive, harass, or send unlawful or misleading messages, including signatures that impersonate another person or organisation;</li>
            <li>upload content you have no right to use, or that is unlawful, hateful or malicious;</li>
            <li>try to access other people&apos;s data, probe or disrupt the service, or bypass limits or access controls;</li>
            <li>use automated means to scrape the service or to make high-volume requests;</li>
            <li>use the AI features to submit content you are not allowed to share, or to build a competing service.</li>
          </ul>
          <p>We may suspend or remove access, and remove content, if these rules are broken or to protect the service or other people.</p>
        </>
      ),
    },
    {
      id: "content",
      title: "Your content",
      body: (
        <>
          <p>You keep ownership of what you put into the service: your details, signatures and images. You give us permission to store, process, resize and display it as needed to run the service for you, including serving uploaded images to anyone who opens an email containing your signature, and to send it to the providers named in the privacy policy to provide the features you use.</p>
          <p>You are responsible for having the right to use the logos, photos and text you add, and for the accuracy of what your signature says.</p>
        </>
      ),
    },
    {
      id: "ai",
      title: "AI features",
      body: (
        <p>
          AI features send what you submit to a third-party AI provider and return a draft. Drafts can be wrong or incomplete. You must review them before use and you are responsible for what you send. AI features are for signed-in people and are limited per person per minute and per day, as set by the operator and visible to you in the service.
        </p>
      ),
    },
    {
      id: "limits",
      title: "Usage limits for public users",
      body: (
        <>
          <p>To keep the service available for everyone, requests from people who are not signed in are rate limited, and we may throttle or block traffic that looks abusive. Current design limits, per client address:</p>
          <ul>
            <li>
              Public pages and cheap lookups: about {read.limit} requests per minute.
            </li>
            <li>Anything that writes or sends something: about {PUBLIC_LIMITS.write.limit} per minute.</li>
            <li>The free generator makes no requests to our servers once the page has loaded, so it has no usage limit.</li>
            <li>AI is never available without signing in.</li>
          </ul>
          <p>Signed-in limits are set by the operator and can differ by person. Limits can change without notice.</p>
        </>
      ),
    },
    {
      id: "google",
      title: "Google Workspace connection",
      body: <p>If you connect a Google account, you authorise the service to change signature settings on that account only after you review and confirm the change, as described in the privacy policy. You are responsible for whether your organisation allows this. You can disconnect at any time.</p>,
    },
    {
      id: "compat",
      title: "Email apps and what we do not promise",
      body: (
        <p>
          We design signatures to follow the constraints common mail apps place on HTML, but each app renders email differently and changes over time. We do not promise that a signature will look the same, or appear at all, in a given app, device or setting. Test a signature before you rely on it or roll it out. Recipients may block images.
        </p>
      ),
    },
    {
      id: "warranty",
      title: "No warranty",
      body: (
        <p>
          The service is provided &quot;as is&quot; and &quot;as available&quot;, without promises of availability, fitness for a particular purpose or freedom from errors, to the extent the law allows. <Todo>Lawyer: confirm wording and any consumer-law carve-outs for the operator&apos;s jurisdictions</Todo>
        </p>
      ),
    },
    {
      id: "liability",
      title: "Limit of liability",
      body: (
        <p>
          To the extent the law allows, the operator is not liable for indirect or consequential loss, or for loss of profit, data or goodwill, arising from your use of the service, and total liability for any claim is limited to <Todo>Lawyer: set the cap, for example fees paid in the last 12 months or a fixed sum</Todo>. Nothing here limits liability that cannot be limited by law.
        </p>
      ),
    },
    {
      id: "ending",
      title: "Ending your use",
      body: (
        <p>
          You can stop using the service at any time and ask us to close your account at <ContactLine brand={brand} />. We may suspend or end access for breach of these terms or to protect the service, and will try to give notice where it is reasonable. Sections that by their nature should continue (for example liability and governing law) continue after that.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to these terms",
      body: <p>We may update these terms. If a change matters, we will tell account holders in the service or by email. Using the service after a change means you accept it. Last reviewed: <Todo>date, set when the lawyer approves</Todo></p>,
    },
    {
      id: "law",
      title: "Governing law and contact",
      body: (
        <p>
          These terms are governed by the laws of {brand.jurisdiction ?? <Todo>jurisdiction: set BRAND_JURISDICTION</Todo>}. <Todo>Lawyer: add the venue for disputes</Todo> Questions about these terms: <ContactLine brand={brand} />.
        </p>
      ),
    },
  ];

  return (
    <LegalDoc
      title="Terms of service"
      intro={
        <>
          <p>The rules for using {brand.name}. They are written to be readable; the sections below carry the detail.</p>
        </>
      }
      sections={sections}
    />
  );
}
