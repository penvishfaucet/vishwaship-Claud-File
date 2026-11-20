import { ANDROID_RELEASE as R } from "@/lib/android-release";
import { SITE } from "@/lib/site";

export const metadata = { title: "Download the Vishwaship Android app — Vishwaship" };

/** Direct APK download (until the app is on Google Play). Same account as the website. */
export default function DownloadAppPage() {
  return (
    <section className="vs-sec">
      <div className="vs-wrap vs-legal" style={{ maxWidth: 820 }}>
        <span className="vs-eyebrow">ANDROID APP</span>
        <h1 className="vs-h2">Vishwaship for Android</h1>
        <p className="mt16">
          Book shipments, compare courier rates, print labels, recharge your wallet and track orders from your phone.
          Sign in with your existing Vishwaship email or mobile and password. Your orders, wallet and tickets are the same as on the website.
        </p>
        <div className="card mt16" style={{ padding: 16 }}>
          <p style={{ margin: 0 }}>
            <a className="btn btn-primary" href={R.file} download>Download APK (v{R.versionName}{R.sizeMb ? `, ${R.sizeMb} MB` : ""})</a>
          </p>
          <p className="mt16" style={{ margin: "12px 0 0", fontSize: 13, opacity: 0.8 }}>
            Requires {R.minAndroid} or newer. Released {R.releasedOn}.
            {R.sha256 ? <> SHA-256: <code style={{ wordBreak: "break-all" }}>{R.sha256}</code></> : null}
          </p>
        </div>
        <h3 className="mt16">How to install</h3>
        <ol style={{ lineHeight: 1.8 }}>
          <li>Open this page on your Android phone and tap <b>Download APK</b>.</li>
          <li>Open the downloaded file. If Android asks, allow your browser to <b>install unknown apps</b> (Settings → Apps → your browser → Install unknown apps).</li>
          <li>Tap <b>Install</b>, then open <b>Vishwaship</b> and sign in.</li>
        </ol>
        <h3 className="mt16">इंस्टॉल कैसे करें</h3>
        <ol style={{ lineHeight: 1.8 }}>
          <li>यह पेज अपने Android फ़ोन पर खोलें और <b>Download APK</b> दबाएँ।</li>
          <li>डाउनलोड हुई फ़ाइल खोलें। अगर फ़ोन पूछे, तो अपने ब्राउज़र को <b>अनजान ऐप इंस्टॉल करने की अनुमति</b> दें।</li>
          <li><b>Install</b> दबाएँ, फिर <b>Vishwaship</b> ऐप खोलकर अपने अकाउंट से लॉगिन करें।</li>
        </ol>
        <p className="mt16" style={{ fontSize: 13, opacity: 0.8 }}>
          Download the app only from vishwaship.in. Questions? Email <a className="link" href={`mailto:${SITE.email}`}>{SITE.email}</a>.
          To delete your account see <a className="link" href="/account-deletion/">Account deletion</a>.
        </p>
      </div>
    </section>
  );
}
