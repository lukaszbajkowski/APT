"""Powiadomienia push: zapis urządzenia, ogólna treść, powiadomienia o dokumencie i wiadomościach."""

from app import push

SUB = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/abc123",
    "keys": {"p256dh": "B" * 40, "auth": "a" * 16},
}


def test_subscribe_and_test(admin_client):
    push.outbox = []
    assert len(admin_client.get("/api/push/key").json()["public_key"]) > 60
    assert admin_client.get("/api/push/status").json()["devices"] == 0
    assert admin_client.post("/api/push/test").status_code == 400
    assert admin_client.post("/api/push/subscribe", json={**SUB, "endpoint": "http://zle"}).status_code == 400
    assert admin_client.post("/api/push/subscribe", json=SUB).status_code == 204
    assert admin_client.post("/api/push/subscribe", json=SUB).status_code == 204  # to samo urządzenie
    st = admin_client.get("/api/push/status", params={"endpoint": SUB["endpoint"]}).json()
    assert st == {"devices": 1, "this_device": True, "other_accounts": 0}
    assert admin_client.post("/api/push/test").json() == {"sent": 1, "failed": []}
    uid, title, _, url = push.outbox[-1]
    assert title == "Test powiadomień" and url == f"/?u={uid}"
    assert admin_client.post("/api/push/unsubscribe", json={"endpoint": SUB["endpoint"]}).status_code == 204
    assert admin_client.get("/api/push/status").json()["devices"] == 0
    push.outbox = None


def test_vapid_keys_are_stable(tmp_path, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "data_dir", str(tmp_path))
    first = push.public_key()
    assert push.public_key() == first
    assert "PRIVATE" not in (tmp_path / "vapid.json").read_text()


def test_real_webpush_library_signs_request(tmp_path, monkeypatch):
    """Przepuszcza wysyłkę przez prawdziwą bibliotekę (tylko sieć jest podmieniona)."""
    import base64
    import os
    from unittest import mock

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "data_dir", str(tmp_path))
    k = ec.generate_private_key(ec.SECP256R1())
    pub = k.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    keys = {
        "p256dh": base64.urlsafe_b64encode(pub).rstrip(b"=").decode(),
        "auth": base64.urlsafe_b64encode(os.urandom(16)).rstrip(b"=").decode(),
    }

    class Resp:
        status_code = 201
        text = ""
        headers: dict = {}

        def raise_for_status(self):
            pass

    with mock.patch("requests.post", return_value=Resp()) as post:
        out = push._deliver(
            [(0, {"endpoint": "https://web.push.apple.com/x", "keys": keys}, 7)], "T", "B", "/a"
        )
    assert out == ["ok"]
    headers = post.call_args.kwargs["headers"]
    assert headers["authorization"].startswith("vapid t=") and "k=" in headers["authorization"]
    assert headers["content-encoding"] == "aes128gcm"


def test_one_browser_can_serve_two_accounts(admin_client, make_user):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.models import Role
    from tests.conftest import login

    make_user("drugie_konto", Role.hr)
    other = TestClient(app)
    login(other, "drugie_konto")
    push.outbox = []
    try:
        assert admin_client.post("/api/push/subscribe", json=SUB).status_code == 204
        assert (
            other.post("/api/push/subscribe", json=SUB).status_code == 204
        )  # to samo urządzenie, inne konto
        st = admin_client.get("/api/push/status", params={"endpoint": SUB["endpoint"]}).json()
        assert st["this_device"] is True and st["other_accounts"] == 1
        # test wysyła tylko do urządzeń bieżącego konta
        assert other.post("/api/push/test", json={"endpoint": SUB["endpoint"]}).json()["sent"] == 1
        assert (
            other.post(
                "/api/push/test", json={"endpoint": "https://fcm.googleapis.com/fcm/send/inne"}
            ).status_code
            == 400
        )
        assert len(push.outbox) == 1
        # wyłączenie jednego konta nie rusza drugiego
        admin_client.post("/api/push/unsubscribe", json={"endpoint": SUB["endpoint"]})
        assert (
            other.get("/api/push/status", params={"endpoint": SUB["endpoint"]}).json()["this_device"] is True
        )
    finally:
        push.outbox = None


def test_only_real_push_services_are_accepted(admin_client):
    """Serwer nie łączy się z adresami spoza usług push (ochrona przed SSRF)."""
    for bad in (
        "https://127.0.0.1/x",
        "https://localhost/x",
        "https://169.254.169.254/latest",
        "https://evil.example.com/x",
        "https://fcm.googleapis.com.evil.com/x",
        "https://evilfcm.googleapis.com.evil.com/x",
        "https://fcm.googleapis.com@evil.com/x",
        "https://user:pw@fcm.googleapis.com/x",
        "https://fcm.googleapis.com:8443/x",
        "http://fcm.googleapis.com/x",
    ):
        r = admin_client.post("/api/push/subscribe", json={**SUB, "endpoint": bad})
        assert r.status_code == 400, bad
    for good in (
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://web.push.apple.com/Qabc",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ):
        assert admin_client.post("/api/push/subscribe", json={**SUB, "endpoint": good}).status_code == 204, (
            good
        )
