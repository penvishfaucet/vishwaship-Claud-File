import { ChangePassword } from "@/components/portal/ChangePassword";
import { ThemePicker } from "@/components/portal/ThemePicker";
import { customerLogoutAll } from "@/server/auth/actions";

export default function SettingsPage() {
  return (
    <>
      <div className="page-h"><h1>Settings</h1></div>
      <section className="card mb12" style={{ padding: 16 }}>
        <h2 className="b small" style={{ marginTop: 0 }}>Appearance</h2>
        <ThemePicker />
      </section>
      <section className="card mb12" style={{ padding: 16, scrollMarginTop: 80 }} id="password">
        <h2 className="b small" style={{ marginTop: 0 }}>Change password</h2>
        <ChangePassword />
      </section>
      <section className="card" style={{ padding: 16 }}>
        <h2 className="b small" style={{ marginTop: 0 }}>Security</h2>
        <p className="small muted">Sign out of Vishwaship on every device and browser, including this one.</p>
        <form action={customerLogoutAll}><button className="btn btn-outline">Log out from all devices</button></form>
      </section>
    </>
  );
}
