# Extractor pentru pista exactă

Componentă pregătită pentru un serviciu Docker Render Free. Nu este încă publicată. Contul de găzduire și testul din cloud sunt necesare înainte de activare. Nu necesită chei Gemini sau debrid în configurația containerului.

Deploy din acest director cu `Dockerfile` și `render.yaml`. Păstrează secretul generat numai în setările serviciului. Configurează pe addon `EXTRACTION_SERVICE_URL` cu originea HTTPS Render și același `EXTRACTION_SERVICE_SECRET` ca secret. Nu publica aceste valori în repository.

Workerul trimite numai adresa temporară a fișierului exact și indexul pistei, după selectarea subtitrării. Containerul demuxează textul folosind FFmpeg; nu transcodează video. Nu salvează video pe disc și nu afișează URL-uri în loguri. Citește totuși date video prin rețea. Intrările sunt limitate la domeniile furnizorilor, iar accesul la extragere necesită secret. Rezultatele sunt temporare în RAM; traducerile finale rămân în baza addonului.

Planul gratuit Render intră în repaus după 15 minute fără trafic, iar repornirea poate dura aproximativ un minut. Are limite lunare și poate fi suspendat pentru trafic inițiat excesiv. Nu garantează acces RD/TB din IP-uri cloud; acesta trebuie verificat. Nu adăuga card și nu schimba planul pentru această instalare gratuită.

Implementarea integrată acum acoperă Real-Debrid. Pentru TorBox, serviciul trebuie încă legat la adresa directă și la pista identificată; această cale nu este activată sau verificată.
