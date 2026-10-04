# Extractor pentru pista exactă

Componentă Docker publicată pe Render Free la https://subtitrari-extractor.onrender.com. Extragerea completă din cloud a fost verificată pentru un fișier Real-Debrid cu 2.332 de replici. Nu necesită chei Gemini sau debrid în configurația containerului.

Deploy din acest director cu `Dockerfile` și `render.yaml`. Păstrează secretul generat numai în setările serviciului. În pagina privată a addonului, secțiunea „Extragere din video”, salvează originea HTTPS Render și același secret. Configurația este criptată. Variabilele `EXTRACTION_SERVICE_URL` și `EXTRACTION_SERVICE_SECRET` sunt alternativa pentru administrator. Nu publica secretul în repository.

Workerul trimite numai adresa temporară a fișierului exact și indexul pistei, după selectarea subtitrării. Pentru MKV cu pistă SRT și index complet, extractorul citește prin HTTP Range indexul și blocurile subtitrării, sărind peste datele video. Verifică identitatea pistei, numărul total de replici și timpii fiecărui bloc. Traficul acestei căi este limitat la 24 MB, cu patru cereri simultane și reîncercare pentru întreruperi temporare. Nu acceptă subtitrări parțiale. Viteza depinde și de latența și limitele furnizorului.

Dacă indexul nu permite extragerea sigură sau pista nu este SRT, folosește FFmpeg. Această cale poate citi o mare parte din video prin rețea; nu transcodează și nu salvează video pe disc. Nu afișează URL-uri în loguri. Intrările sunt limitate la domeniile furnizorilor, iar accesul la extragere necesită secret. Rezultatele sunt temporare în RAM; traducerile finale rămân în baza addonului.

FFmpeg folosește `-copyts -avoid_negative_ts disabled` pentru a păstra timpii pistei. Corectarea timpilor reutilizează o traducere completă numai dacă toate replicile sursei sunt identice și în aceeași ordine.

Planul gratuit Render intră în repaus după 15 minute fără trafic, iar repornirea poate dura aproximativ un minut. Are limite lunare și poate fi suspendat pentru trafic inițiat excesiv. Nu garantează acces RD/TB din IP-uri cloud; acesta trebuie verificat. Nu adăuga card și nu schimba planul pentru această instalare gratuită.

Implementarea integrată acum acoperă Real-Debrid. Pentru TorBox, serviciul trebuie încă legat la adresa directă și la pista identificată; această cale nu este activată sau verificată.
