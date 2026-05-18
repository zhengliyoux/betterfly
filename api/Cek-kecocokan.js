module.exports = {
  name: "Cek Kecocokan Nama Pasangan",
  desc: "Hitung kecocokan nama pasangan",
  category: "Random",
  path: "/random/pasangan?nama1=&nama2=",

  async run(req, res) {
    const { nama1, nama2 } = req.query;
    if (!nama1 || !nama2) {
      return res.json({
        status: false,
        error: "Masukkan kedua nama. Contoh: ?nama1=Putra&nama2=Olivia"
      });
    }

    const totalChar = (nama1 + nama2).replace(/\s+/g, "").length;
    const score = ((totalChar * 37) % 101);

    let keterangan;
    if (score > 80) keterangan = "💖 Sangat Serasi, cocok jadi pasangan sejati!";
    else if (score > 60) keterangan = "💘 Cukup Serasi, ada peluang besar!";
    else if (score > 40) keterangan = "🤝 Lumayan cocok, masih butuh pengertian.";
    else if (score > 20) keterangan = "🙂 Kurang cocok, tapi masih bisa diusahakan.";
    else keterangan = "💔 Sepertinya sulit cocok, tapi siapa tahu jodoh itu misteri.";

    res.json({
      status: true,
      pasangan: `${nama1} ❤️ ${nama2}`,
      persentase: `${score}%`,
      keterangan
    });
  }
};
