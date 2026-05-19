const axios = require("axios");

async function cekEwallet(provider, nomor) {
  try {
    const timestamp = Date.now().toString();

    const params = new URLSearchParams();
    params.append("app_reg_id", "");
    params.append("phone_uuid", "");
    params.append("phone_model", "");
    params.append("phoneNumber", nomor);
    params.append("request_time", timestamp);
    params.append("phone_android_version", "");
    params.append("app_version_code", "");
    params.append("auth_username", "");
    params.append("customerId", "");
    params.append("id", provider);
    params.append("auth_token", "");
    params.append("app_version_name", "");
    params.append("ui_mode", "dark");

    const config = {
      method: "POST",
      url: `https://checker.orderkuota.com/api/checkname/produk/bff66b406f/06/2604338/${provider}`,
      headers: {
        "User-Agent": "okhttp/4.12.0",
        "Accept-Encoding": "gzip",
        "Content-Type": "application/x-www-form-urlencoded",
        "signature": "b2d5d7a5a3d69e7f208343fd0d278a5f1c55e42e109c58203103e634875becd946e547d5b4fe307e6cf0bcd70884d10dbdc3a58368d02e0ae64b7cd741ec354c",
        "timestamp": timestamp,
      },
      data: params.toString(),
    };

    const response = await axios.request(config);
    return { status: true, result: response.data };
  } catch (err) {
    return { status: false, error: err.message };
  }
}

// ROUTE EXPORT
module.exports = [
  {
    name: "Cek Ewallet Dana",
    desc: "Cek nama akun Dana",
    category: "Tools",
    path: "/tools/cekewallet/dana?nomor=",
    async run(req, res) {
      const { nomor } = req.query;
      if (!nomor) return res.json({ status: false, error: "Missing nomor" });
      const result = await cekEwallet("dana", nomor);
      res.json(result);
    },
  },
  {
    name: "Cek Ewallet OVO",
    desc: "Cek nama akun OVO",
    category: "Tools",
    path: "/tools/cekewallet/ovo?nomor=",
    async run(req, res) {
      const { nomor } = req.query;
      if (!nomor) return res.json({ status: false, error: "Missing nomor" });
      const result = await cekEwallet("ovo", nomor);
      res.json(result);
    },
  },
  {
    name: "Cek Ewallet Gopay",
    desc: "Cek nama akun Gopay",
    category: "Tools",
    path: "/tools/cekewallet/gopay?nomor=",
    async run(req, res) {
      const { nomor } = req.query;
      if (!nomor) return res.json({ status: false, error: "Missing nomor" });
      const result = await cekEwallet("gopay", nomor);
      res.json(result);
    },
  },
  {
    name: "Cek Ewallet Shopeepay",
    desc: "Cek nama akun Shopeepay",
    category: "Tools",
    path: "/tools/cekewallet/shopeepay?nomor=",
    async run(req, res) {
      const { nomor } = req.query;
      if (!nomor) return res.json({ status: false, error: "Missing nomor" });
      const result = await cekEwallet("shopeepay", nomor);
      res.json(result);
    },
  },
  {
    name: "Cek Ewallet LinkAja",
    desc: "Cek nama akun LinkAja",
    category: "Tools",
    path: "/tools/cekewallet/linkaja?nomor=",
    async run(req, res) {
      const { nomor } = req.query;
      if (!nomor) return res.json({ status: false, error: "Missing nomor" });
      const result = await cekEwallet("linkaja", nomor);
      res.json(result);
    },
  },
];
