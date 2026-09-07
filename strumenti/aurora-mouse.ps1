<#
    aurora-mouse.ps1 — Ponte fra Aurora e il mouse di Windows.

    ═══════════════════════════════════════════════════════════════════
    NESSUNA INSTALLAZIONE
    ═══════════════════════════════════════════════════════════════════

    Non serve Python, non servono librerie, non servono permessi di
    amministratore. PowerShell è già dentro Windows, e muovere il mouse
    è una chiamata al sistema che Windows offre da sempre.

    Si avvia con un doppio clic su "avvia-mouse.bat", oppure da un
    terminale con:

        powershell -ExecutionPolicy Bypass -File aurora-mouse.ps1

    Poi in Aurora: Impostazioni → Dispositivo → collegamento "ponte".

    ═══════════════════════════════════════════════════════════════════
    PERCHÉ NON È BANALE COME SEMBRA
    ═══════════════════════════════════════════════════════════════════

    Muovere il mouse è facile: una riga. La parte lunga è ricevere i
    comandi dal browser, perché una pagina web può parlare solo con
    protocolli che il browser conosce — e il più semplice è WebSocket.

    Qui il protocollo è implementato a mano su una presa di rete
    ordinaria: bastano una stretta di mano e la lettura dei pacchetti.
    Non serve alcuna libreria, e non serve registrare nulla nel
    sistema, quindi funziona per qualunque utente senza privilegi.

    ═══════════════════════════════════════════════════════════════════
    PROTOCOLLO — una riga per comando
    ═══════════════════════════════════════════════════════════════════

        M <dx> <dy>     sposta il cursore
        C <n>           clic: 1 sinistro, 2 destro, 3 centrale
        K <n>           doppio clic
        T <n> <0|1>     tiene premuto (1) o rilascia (0)
        W <n>           rotellina, positivo verso l'alto
        ?               stato
        S               arresto: rilascia tutti i pulsanti

    ═══════════════════════════════════════════════════════════════════
    ⚠️ SICUREZZA
    ═══════════════════════════════════════════════════════════════════

    Chi usa questo ponte non può prendere il mouse e rimetterlo a posto
    se qualcosa va storto. Quindi:

      · ascolta SOLO su 127.0.0.1: nessuno dalla rete può raggiungerlo;
      · limita quanto il cursore può muoversi in un secondo;
      · se il collegamento cade, rilascia tutti i pulsanti — uno
        rimasto premuto renderebbe il computer inutilizzabile;
      · si ferma con Ctrl+C o chiudendo la finestra.
#>

$ErrorActionPreference = 'Stop'
$Indirizzo = '127.0.0.1'
$Porta     = 8089

# Quanto può muoversi il cursore in un secondo, in pixel. Un guasto del
# rilevamento oculare non deve poterlo far impazzire.
$MaxPixelAlSecondo = 4000
$MaxPasso          = 200

# ── Accesso al mouse di Windows ────────────────────────────────────
# `mouse_event` fa parte di Windows da trent'anni: nessuna dipendenza.
Add-Type -Namespace AuroraWin -Name Topo -MemberDefinition @'
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out System.Drawing.Point p);
'@ -UsingNamespace System.Drawing -ReferencedAssemblies System.Drawing

$MOVE      = 0x0001
$LDOWN     = 0x0002; $LUP = 0x0004
$RDOWN     = 0x0008; $RUP = 0x0010
$MDOWN     = 0x0020; $MUP = 0x0040
$WHEEL     = 0x0800

$script:credito = $MaxPixelAlSecondo
$script:ultimo  = [DateTime]::UtcNow
$script:mosse   = 0
$script:clic    = 0
$script:scarti  = 0
$script:premuti = @()

function Consenti-Movimento([int]$distanza) {
    $ora = [DateTime]::UtcNow
    $dt  = ($ora - $script:ultimo).TotalSeconds
    $script:ultimo = $ora
    $script:credito = [Math]::Min($MaxPixelAlSecondo, $script:credito + $dt * $MaxPixelAlSecondo)
    if ($distanza -le $script:credito) { $script:credito -= $distanza; return $true }
    return $false
}

function Giu-Su([int]$n) {
    switch ($n) {
        2 { @($RDOWN, $RUP) }
        3 { @($MDOWN, $MUP) }
        default { @($LDOWN, $LUP) }
    }
}

function Rilascia-Tutto {
    # ⚠️ Un pulsante rimasto premuto rende il computer inutilizzabile,
    # e chi usa Aurora non può rimediare da solo.
    foreach ($u in @($LUP, $RUP, $MUP)) {
        [AuroraWin.Topo]::mouse_event($u, 0, 0, 0, 0)
    }
    $script:premuti = @()
}

function Esegui([string]$riga) {
    $p = $riga.Trim() -split '\s+'
    if ($p.Count -eq 0 -or $p[0] -eq '') { return 'ERR vuoto' }
    $cmd = $p[0].ToUpper()

    try {
        switch ($cmd) {
            'M' {
                if ($p.Count -lt 3) { return 'ERR argomenti' }
                $dx = [int][double]$p[1]; $dy = [int][double]$p[2]
                if ($dx -gt $MaxPasso) { $dx = $MaxPasso } elseif ($dx -lt -$MaxPasso) { $dx = -$MaxPasso }
                if ($dy -gt $MaxPasso) { $dy = $MaxPasso } elseif ($dy -lt -$MaxPasso) { $dy = -$MaxPasso }
                if ($dx -eq 0 -and $dy -eq 0) { return 'OK' }
                if (-not (Consenti-Movimento ([Math]::Abs($dx) + [Math]::Abs($dy)))) {
                    $script:scarti++
                    return 'ERR troppo veloce'
                }
                [AuroraWin.Topo]::mouse_event($MOVE, $dx, $dy, 0, 0)
                $script:mosse++
                return 'OK'
            }
            'C' {
                $b = Giu-Su ([int]$p[1])
                [AuroraWin.Topo]::mouse_event($b[0], 0, 0, 0, 0)
                [AuroraWin.Topo]::mouse_event($b[1], 0, 0, 0, 0)
                $script:clic++
                return 'OK'
            }
            'K' {
                $b = Giu-Su ([int]$p[1])
                foreach ($i in 1..2) {
                    [AuroraWin.Topo]::mouse_event($b[0], 0, 0, 0, 0)
                    [AuroraWin.Topo]::mouse_event($b[1], 0, 0, 0, 0)
                    Start-Sleep -Milliseconds 40
                }
                $script:clic++
                return 'OK'
            }
            'T' {
                if ($p.Count -lt 3) { return 'ERR argomenti' }
                $b = Giu-Su ([int]$p[1])
                if ($p[2] -eq '1') {
                    [AuroraWin.Topo]::mouse_event($b[0], 0, 0, 0, 0)
                    $script:premuti += $p[1]
                } else {
                    [AuroraWin.Topo]::mouse_event($b[1], 0, 0, 0, 0)
                }
                return 'OK'
            }
            'W' {
                [AuroraWin.Topo]::mouse_event($WHEEL, 0, 0, ([int][double]$p[1]) * 120, 0)
                return 'OK'
            }
            'S' { Rilascia-Tutto; return 'OK arresto' }
            '?' {
                $pt = New-Object System.Drawing.Point
                [void][AuroraWin.Topo]::GetCursorPos([ref]$pt)
                return "ST $($pt.X) $($pt.Y) mosse $script:mosse clic $script:clic"
            }
            # Comandi del braccio robotico: riconosciuti e ignorati, così
            # lo stesso ponte serve a entrambi senza dare errori.
            { $_ -in 'P','D','G','B','H' } { return 'OK' }
            default { return "ERR comando sconosciuto: $cmd" }
        }
    } catch {
        return "ERR $($_.Exception.Message)"
    }
}

# ── WebSocket, implementato a mano ─────────────────────────────────
# Si usa una presa di rete ordinaria invece delle interfacce di sistema
# perché quelle richiederebbero una registrazione da amministratore.
# Così funziona per qualunque utente, senza privilegi.

function Chiave-Risposta([string]$chiave) {
    $magia = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
    $sha = [System.Security.Cryptography.SHA1]::Create()
    $b = $sha.ComputeHash([Text.Encoding]::ASCII.GetBytes($chiave + $magia))
    return [Convert]::ToBase64String($b)
}

function Invia-Testo($flusso, [string]$testo) {
    $dati = [Text.Encoding]::UTF8.GetBytes($testo)
    $out = New-Object System.Collections.Generic.List[byte]
    $out.Add(0x81)                              # ultimo pacchetto, testo
    if ($dati.Length -lt 126) {
        $out.Add([byte]$dati.Length)
    } elseif ($dati.Length -lt 65536) {
        $out.Add(126)
        $out.Add([byte](($dati.Length -shr 8) -band 0xFF))
        $out.Add([byte]($dati.Length -band 0xFF))
    } else { return }
    $out.AddRange($dati)
    $a = $out.ToArray()
    $flusso.Write($a, 0, $a.Length)
    $flusso.Flush()
}

function Leggi-Esatto($flusso, [int]$quanti) {
    $buf = New-Object byte[] $quanti
    $letti = 0
    while ($letti -lt $quanti) {
        $n = $flusso.Read($buf, $letti, $quanti - $letti)
        if ($n -le 0) { return $null }
        $letti += $n
    }
    return $buf
}

Write-Host ''
Write-Host '  ╭───────────────────────────────────────────────╮'
Write-Host '  │  Aurora — ponte per il mouse (Windows)         │'
Write-Host '  ╰───────────────────────────────────────────────╯'
Write-Host "  in ascolto su ws://$Indirizzo`:$Porta/device"
Write-Host '  (solo dal computer locale: nessuno dalla rete puo connettersi)'
Write-Host ''
Write-Host '  In Aurora: Impostazioni -> Dispositivo -> collegamento "ponte"'
Write-Host '  Per fermare: chiudi questa finestra, oppure Ctrl+C'
Write-Host ''

$ascolto = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($Indirizzo), $Porta)
$ascolto.Start()

try {
    while ($true) {
        $cliente = $ascolto.AcceptTcpClient()
        $cliente.NoDelay = $true
        $flusso = $cliente.GetStream()
        Write-Host '  <- Aurora collegata'

        try {
            # ── Stretta di mano ──
            $buf = New-Object byte[] 4096
            $n = $flusso.Read($buf, 0, $buf.Length)
            $richiesta = [Text.Encoding]::ASCII.GetString($buf, 0, $n)
            if ($richiesta -notmatch 'Sec-WebSocket-Key:\s*(.+)') {
                $cliente.Close(); continue
            }
            $accetta = Chiave-Risposta ($matches[1].Trim())
            $risposta = "HTTP/1.1 101 Switching Protocols`r`n" +
                        "Upgrade: websocket`r`n" +
                        "Connection: Upgrade`r`n" +
                        "Sec-WebSocket-Accept: $accetta`r`n`r`n"
            $rb = [Text.Encoding]::ASCII.GetBytes($risposta)
            $flusso.Write($rb, 0, $rb.Length); $flusso.Flush()

            # ── Pacchetti ──
            while ($cliente.Connected) {
                $testa = Leggi-Esatto $flusso 2
                if ($null -eq $testa) { break }
                $opcode = $testa[0] -band 0x0F
                if ($opcode -eq 8) { break }                 # chiusura
                $mascherato = ($testa[1] -band 0x80) -ne 0
                $lung = $testa[1] -band 0x7F
                if ($lung -eq 126) {
                    $e = Leggi-Esatto $flusso 2
                    $lung = ($e[0] -shl 8) -bor $e[1]
                } elseif ($lung -eq 127) { break }           # troppo grande
                $maschera = if ($mascherato) { Leggi-Esatto $flusso 4 } else { $null }
                $dati = if ($lung -gt 0) { Leggi-Esatto $flusso $lung } else { New-Object byte[] 0 }
                if ($null -eq $dati) { break }
                if ($mascherato) {
                    for ($i = 0; $i -lt $dati.Length; $i++) {
                        $dati[$i] = $dati[$i] -bxor $maschera[$i % 4]
                    }
                }
                if ($opcode -ne 1) { continue }              # solo testo
                $messaggio = [Text.Encoding]::UTF8.GetString($dati)
                foreach ($riga in ($messaggio -split "`n")) {
                    if ($riga.Trim()) { Invia-Testo $flusso (Esegui $riga) }
                }
            }
        } catch {
            # Un collegamento caduto non deve fermare il ponte.
        } finally {
            Rilascia-Tutto
            try { $cliente.Close() } catch {}
            Write-Host '  -> Aurora scollegata (pulsanti rilasciati)'
        }
    }
} finally {
    Rilascia-Tutto
    $ascolto.Stop()
    Write-Host "  fermato - mosse $script:mosse, clic $script:clic, scartate $script:scarti"
}
