import "server-only";

/**
 * Sürücü-dostu jenerik OBD-II (SAE J2012) arıza kodu sözlüğü — TR + DE.
 *
 * Yalnız SUNUCUDA kullanılır (araç detay sayfası aktif kodları render'dan önce
 * zenginleştirir); sözlük client bundle'a asla girmez. Sözlükte OLMAYAN bir kod
 * için lookupDtc null döner ve UI tek bir güvenli "üretici-spesifik kod" metni
 * gösterir — tanım ASLA uydurulmaz (ör. P225C bilinçli olarak dışarıda).
 *
 * İçerik üretimi: her kod aralığı bağımsız üretildi ve ikinci bir adversarial
 * denetimden geçirildi; emin olunamayan kodlar sözlüğe hiç alınmadı.
 * Bu dosya üretilmiştir — elle düzenleme yerine sözlük pipeline'ını kullanın.
 */

export type DtcText = {
  /** Kodun standart teknik adı (kısa). */
  title: string;
  /** Hangi parça/sistem — sade dille. */
  part: string;
  /** Sürücünün hissedebileceği belirtiler. */
  symptoms: string;
  /** İhmal edilirse risk + aciliyet. */
  risk: string;
};

export type DtcInfo = { tr: DtcText; de: DtcText };

export const DTC_CODES: Record<string, DtcInfo> = {
  "P0010": {
    "tr": {
      "title": "Eksantrik Mili Konum Aktüatörü 'A' Devresi (Bank 1)",
      "part": "Motorun supap zamanlamasını ayarlayan elektrikli valf (VVT solenoidi) veya kablosu.",
      "symptoms": "Güç kaybı, düzensiz rölanti ve yakıt tüketiminde artış hissedilebilir.",
      "risk": "Uzun süre ihmal edilirse motor performansı düşer ve yakıt maliyeti artar; yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Nockenwellenversteller 'A' Stromkreis (Bank 1)",
      "part": "Elektrisches Ventil (VVT-Magnetventil), das die Ventilsteuerzeiten des Motors verstellt, oder dessen Verkabelung.",
      "symptoms": "Leistungsverlust, unruhiger Leerlauf und erhöhter Kraftstoffverbrauch sind möglich.",
      "risk": "Bei längerem Ignorieren sinkt die Motorleistung und der Verbrauch steigt; zeitnah in die Werkstatt bringen."
    }
  },
  "P0011": {
    "tr": {
      "title": "Eksantrik Mili 'A' Zamanlaması Aşırı İleri (Bank 1)",
      "part": "Değişken supap zamanlaması (VVT) sistemi; genellikle solenoid valf, zincir gerginliği veya kirli/eksik motor yağı kaynaklıdır.",
      "symptoms": "Zor çalışma, düzensiz rölanti, güç kaybı ve artan yakıt tüketimi görülebilir.",
      "risk": "İhmal edilirse motorda ciddi hasara yol açabilir; kısa sürede servise gidin ve yağ seviyesini kontrol ettirin."
    },
    "de": {
      "title": "Nockenwelle 'A' Steuerzeiten zu früh (Bank 1)",
      "part": "System der variablen Ventilsteuerung (VVT); oft liegt es am Magnetventil, an der Kettenspannung oder an verschmutztem bzw. zu wenig Motoröl.",
      "symptoms": "Schwerer Motorstart, unruhiger Leerlauf, Leistungsverlust und Mehrverbrauch sind möglich.",
      "risk": "Unbehandelt drohen ernste Motorschäden; bald in die Werkstatt fahren und den Ölstand prüfen lassen."
    }
  },
  "P0012": {
    "tr": {
      "title": "Eksantrik Mili 'A' Zamanlaması Aşırı Geri (Bank 1)",
      "part": "Değişken supap zamanlaması (VVT) sistemi; genellikle solenoid valf, zincir gerginliği veya kirli/eksik motor yağı kaynaklıdır.",
      "symptoms": "Zor çalışma, düzensiz rölanti, güç kaybı ve artan yakıt tüketimi görülebilir.",
      "risk": "İhmal edilirse motorda ciddi hasara yol açabilir; kısa sürede servise gidin ve yağ seviyesini kontrol ettirin."
    },
    "de": {
      "title": "Nockenwelle 'A' Steuerzeiten zu spät (Bank 1)",
      "part": "System der variablen Ventilsteuerung (VVT); oft liegt es am Magnetventil, an der Kettenspannung oder an verschmutztem bzw. zu wenig Motoröl.",
      "symptoms": "Schwerer Motorstart, unruhiger Leerlauf, Leistungsverlust und Mehrverbrauch sind möglich.",
      "risk": "Unbehandelt drohen ernste Motorschäden; bald in die Werkstatt fahren und den Ölstand prüfen lassen."
    }
  },
  "P0013": {
    "tr": {
      "title": "Eksantrik Mili Konum Aktüatörü 'B' Devresi (Bank 1)",
      "part": "Motorun supap zamanlamasını ayarlayan elektrikli valf (VVT solenoidi) veya kablosu.",
      "symptoms": "Güç kaybı, düzensiz rölanti ve yakıt tüketiminde artış hissedilebilir.",
      "risk": "Uzun süre ihmal edilirse motor performansı düşer ve yakıt maliyeti artar; yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Nockenwellenversteller 'B' Stromkreis (Bank 1)",
      "part": "Elektrisches Ventil (VVT-Magnetventil), das die Ventilsteuerzeiten des Motors verstellt, oder dessen Verkabelung.",
      "symptoms": "Leistungsverlust, unruhiger Leerlauf und erhöhter Kraftstoffverbrauch sind möglich.",
      "risk": "Bei längerem Ignorieren sinkt die Motorleistung und der Verbrauch steigt; zeitnah in die Werkstatt bringen."
    }
  },
  "P0014": {
    "tr": {
      "title": "Eksantrik Mili 'B' Zamanlaması Aşırı İleri (Bank 1)",
      "part": "Değişken supap zamanlaması (VVT) sistemi; genellikle solenoid valf, zincir gerginliği veya kirli/eksik motor yağı kaynaklıdır.",
      "symptoms": "Zor çalışma, düzensiz rölanti, güç kaybı ve artan yakıt tüketimi görülebilir.",
      "risk": "İhmal edilirse motorda ciddi hasara yol açabilir; kısa sürede servise gidin ve yağ seviyesini kontrol ettirin."
    },
    "de": {
      "title": "Nockenwelle 'B' Steuerzeiten zu früh (Bank 1)",
      "part": "System der variablen Ventilsteuerung (VVT); oft liegt es am Magnetventil, an der Kettenspannung oder an verschmutztem bzw. zu wenig Motoröl.",
      "symptoms": "Schwerer Motorstart, unruhiger Leerlauf, Leistungsverlust und Mehrverbrauch sind möglich.",
      "risk": "Unbehandelt drohen ernste Motorschäden; bald in die Werkstatt fahren und den Ölstand prüfen lassen."
    }
  },
  "P0015": {
    "tr": {
      "title": "Eksantrik Mili 'B' Zamanlaması Aşırı Geri (Bank 1)",
      "part": "Değişken supap zamanlaması (VVT) sistemi; genellikle solenoid valf, zincir gerginliği veya kirli/eksik motor yağı kaynaklıdır.",
      "symptoms": "Zor çalışma, düzensiz rölanti, güç kaybı ve artan yakıt tüketimi görülebilir.",
      "risk": "İhmal edilirse motorda ciddi hasara yol açabilir; kısa sürede servise gidin ve yağ seviyesini kontrol ettirin."
    },
    "de": {
      "title": "Nockenwelle 'B' Steuerzeiten zu spät (Bank 1)",
      "part": "System der variablen Ventilsteuerung (VVT); oft liegt es am Magnetventil, an der Kettenspannung oder an verschmutztem bzw. zu wenig Motoröl.",
      "symptoms": "Schwerer Motorstart, unruhiger Leerlauf, Leistungsverlust und Mehrverbrauch sind möglich.",
      "risk": "Unbehandelt drohen ernste Motorschäden; bald in die Werkstatt fahren und den Ölstand prüfen lassen."
    }
  },
  "P0016": {
    "tr": {
      "title": "Krank-Eksantrik Mili Konum Uyumsuzluğu (Bank 1 Sensör A)",
      "part": "Krank mili ile eksantrik mili sensörleri arasındaki uyum bozuk; genellikle esnemiş triger zinciri/kayışı veya arızalı sensör kaynaklıdır.",
      "symptoms": "Zor çalışma veya hiç çalışmama, güç kaybı ve motorda titreme görülebilir.",
      "risk": "Triger zinciri/kayışı atlarsa ağır motor hasarı oluşabilir; aracı fazla kullanmadan en kısa sürede servise götürün."
    },
    "de": {
      "title": "Kurbelwelle-Nockenwelle Positionsabweichung (Bank 1 Sensor A)",
      "part": "Die Positionen von Kurbelwelle und Nockenwelle passen nicht zusammen; häufig durch eine gelängte Steuerkette bzw. einen gelängten Zahnriemen oder einen defekten Sensor.",
      "symptoms": "Schlechter oder kein Motorstart, Leistungsverlust und Motorruckeln sind möglich.",
      "risk": "Springt die Steuerkette bzw. der Riemen über, droht ein schwerer Motorschaden; das Fahrzeug möglichst umgehend in die Werkstatt bringen."
    }
  },
  "P0017": {
    "tr": {
      "title": "Krank-Eksantrik Mili Konum Uyumsuzluğu (Bank 1 Sensör B)",
      "part": "Krank mili ile eksantrik mili sensörleri arasındaki uyum bozuk; genellikle esnemiş triger zinciri/kayışı veya arızalı sensör kaynaklıdır.",
      "symptoms": "Zor çalışma veya hiç çalışmama, güç kaybı ve motorda titreme görülebilir.",
      "risk": "Triger zinciri/kayışı atlarsa ağır motor hasarı oluşabilir; aracı fazla kullanmadan en kısa sürede servise götürün."
    },
    "de": {
      "title": "Kurbelwelle-Nockenwelle Positionsabweichung (Bank 1 Sensor B)",
      "part": "Die Positionen von Kurbelwelle und Nockenwelle passen nicht zusammen; häufig durch eine gelängte Steuerkette bzw. einen gelängten Zahnriemen oder einen defekten Sensor.",
      "symptoms": "Schlechter oder kein Motorstart, Leistungsverlust und Motorruckeln sind möglich.",
      "risk": "Springt die Steuerkette bzw. der Riemen über, droht ein schwerer Motorschaden; das Fahrzeug möglichst umgehend in die Werkstatt bringen."
    }
  },
  "P0018": {
    "tr": {
      "title": "Krank-Eksantrik Mili Konum Uyumsuzluğu (Bank 2 Sensör A)",
      "part": "Krank mili ile eksantrik mili sensörleri arasındaki uyum bozuk; genellikle esnemiş triger zinciri/kayışı veya arızalı sensör kaynaklıdır.",
      "symptoms": "Zor çalışma veya hiç çalışmama, güç kaybı ve motorda titreme görülebilir.",
      "risk": "Triger zinciri/kayışı atlarsa ağır motor hasarı oluşabilir; aracı fazla kullanmadan en kısa sürede servise götürün."
    },
    "de": {
      "title": "Kurbelwelle-Nockenwelle Positionsabweichung (Bank 2 Sensor A)",
      "part": "Die Positionen von Kurbelwelle und Nockenwelle passen nicht zusammen; häufig durch eine gelängte Steuerkette bzw. einen gelängten Zahnriemen oder einen defekten Sensor.",
      "symptoms": "Schlechter oder kein Motorstart, Leistungsverlust und Motorruckeln sind möglich.",
      "risk": "Springt die Steuerkette bzw. der Riemen über, droht ein schwerer Motorschaden; das Fahrzeug möglichst umgehend in die Werkstatt bringen."
    }
  },
  "P0019": {
    "tr": {
      "title": "Krank-Eksantrik Mili Konum Uyumsuzluğu (Bank 2 Sensör B)",
      "part": "Krank mili ile eksantrik mili sensörleri arasındaki uyum bozuk; genellikle esnemiş triger zinciri/kayışı veya arızalı sensör kaynaklıdır.",
      "symptoms": "Zor çalışma veya hiç çalışmama, güç kaybı ve motorda titreme görülebilir.",
      "risk": "Triger zinciri/kayışı atlarsa ağır motor hasarı oluşabilir; aracı fazla kullanmadan en kısa sürede servise götürün."
    },
    "de": {
      "title": "Kurbelwelle-Nockenwelle Positionsabweichung (Bank 2 Sensor B)",
      "part": "Die Positionen von Kurbelwelle und Nockenwelle passen nicht zusammen; häufig durch eine gelängte Steuerkette bzw. einen gelängten Zahnriemen oder einen defekten Sensor.",
      "symptoms": "Schlechter oder kein Motorstart, Leistungsverlust und Motorruckeln sind möglich.",
      "risk": "Springt die Steuerkette bzw. der Riemen über, droht ein schwerer Motorschaden; das Fahrzeug möglichst umgehend in die Werkstatt bringen."
    }
  },
  "P0020": {
    "tr": {
      "title": "Eksantrik Mili Konum Aktüatörü 'A' Devresi (Bank 2)",
      "part": "Motorun supap zamanlamasını ayarlayan elektrikli valf (VVT solenoidi) veya kablosu.",
      "symptoms": "Güç kaybı, düzensiz rölanti ve yakıt tüketiminde artış hissedilebilir.",
      "risk": "Uzun süre ihmal edilirse motor performansı düşer ve yakıt maliyeti artar; yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Nockenwellenversteller 'A' Stromkreis (Bank 2)",
      "part": "Elektrisches Ventil (VVT-Magnetventil), das die Ventilsteuerzeiten des Motors verstellt, oder dessen Verkabelung.",
      "symptoms": "Leistungsverlust, unruhiger Leerlauf und erhöhter Kraftstoffverbrauch sind möglich.",
      "risk": "Bei längerem Ignorieren sinkt die Motorleistung und der Verbrauch steigt; zeitnah in die Werkstatt bringen."
    }
  },
  "P0021": {
    "tr": {
      "title": "Eksantrik Mili 'A' Zamanlaması Aşırı İleri (Bank 2)",
      "part": "Değişken supap zamanlaması (VVT) sistemi; genellikle solenoid valf, zincir gerginliği veya kirli/eksik motor yağı kaynaklıdır.",
      "symptoms": "Zor çalışma, düzensiz rölanti, güç kaybı ve artan yakıt tüketimi görülebilir.",
      "risk": "İhmal edilirse motorda ciddi hasara yol açabilir; kısa sürede servise gidin ve yağ seviyesini kontrol ettirin."
    },
    "de": {
      "title": "Nockenwelle 'A' Steuerzeiten zu früh (Bank 2)",
      "part": "System der variablen Ventilsteuerung (VVT); oft liegt es am Magnetventil, an der Kettenspannung oder an verschmutztem bzw. zu wenig Motoröl.",
      "symptoms": "Schwerer Motorstart, unruhiger Leerlauf, Leistungsverlust und Mehrverbrauch sind möglich.",
      "risk": "Unbehandelt drohen ernste Motorschäden; bald in die Werkstatt fahren und den Ölstand prüfen lassen."
    }
  },
  "P0022": {
    "tr": {
      "title": "Eksantrik Mili 'A' Zamanlaması Aşırı Geri (Bank 2)",
      "part": "Değişken supap zamanlaması (VVT) sistemi; genellikle solenoid valf, zincir gerginliği veya kirli/eksik motor yağı kaynaklıdır.",
      "symptoms": "Zor çalışma, düzensiz rölanti, güç kaybı ve artan yakıt tüketimi görülebilir.",
      "risk": "İhmal edilirse motorda ciddi hasara yol açabilir; kısa sürede servise gidin ve yağ seviyesini kontrol ettirin."
    },
    "de": {
      "title": "Nockenwelle 'A' Steuerzeiten zu spät (Bank 2)",
      "part": "System der variablen Ventilsteuerung (VVT); oft liegt es am Magnetventil, an der Kettenspannung oder an verschmutztem bzw. zu wenig Motoröl.",
      "symptoms": "Schwerer Motorstart, unruhiger Leerlauf, Leistungsverlust und Mehrverbrauch sind möglich.",
      "risk": "Unbehandelt drohen ernste Motorschäden; bald in die Werkstatt fahren und den Ölstand prüfen lassen."
    }
  },
  "P0023": {
    "tr": {
      "title": "Eksantrik Mili Konum Aktüatörü 'B' Devresi (Bank 2)",
      "part": "Motorun supap zamanlamasını ayarlayan elektrikli valf (VVT solenoidi) veya kablosu.",
      "symptoms": "Güç kaybı, düzensiz rölanti ve yakıt tüketiminde artış hissedilebilir.",
      "risk": "Uzun süre ihmal edilirse motor performansı düşer ve yakıt maliyeti artar; yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Nockenwellenversteller 'B' Stromkreis (Bank 2)",
      "part": "Elektrisches Ventil (VVT-Magnetventil), das die Ventilsteuerzeiten des Motors verstellt, oder dessen Verkabelung.",
      "symptoms": "Leistungsverlust, unruhiger Leerlauf und erhöhter Kraftstoffverbrauch sind möglich.",
      "risk": "Bei längerem Ignorieren sinkt die Motorleistung und der Verbrauch steigt; zeitnah in die Werkstatt bringen."
    }
  },
  "P0024": {
    "tr": {
      "title": "Eksantrik Mili 'B' Zamanlaması Aşırı İleri (Bank 2)",
      "part": "Değişken supap zamanlaması (VVT) sistemi; genellikle solenoid valf, zincir gerginliği veya kirli/eksik motor yağı kaynaklıdır.",
      "symptoms": "Zor çalışma, düzensiz rölanti, güç kaybı ve artan yakıt tüketimi görülebilir.",
      "risk": "İhmal edilirse motorda ciddi hasara yol açabilir; kısa sürede servise gidin ve yağ seviyesini kontrol ettirin."
    },
    "de": {
      "title": "Nockenwelle 'B' Steuerzeiten zu früh (Bank 2)",
      "part": "System der variablen Ventilsteuerung (VVT); oft liegt es am Magnetventil, an der Kettenspannung oder an verschmutztem bzw. zu wenig Motoröl.",
      "symptoms": "Schwerer Motorstart, unruhiger Leerlauf, Leistungsverlust und Mehrverbrauch sind möglich.",
      "risk": "Unbehandelt drohen ernste Motorschäden; bald in die Werkstatt fahren und den Ölstand prüfen lassen."
    }
  },
  "P0025": {
    "tr": {
      "title": "Eksantrik Mili 'B' Zamanlaması Aşırı Geri (Bank 2)",
      "part": "Değişken supap zamanlaması (VVT) sistemi; genellikle solenoid valf, zincir gerginliği veya kirli/eksik motor yağı kaynaklıdır.",
      "symptoms": "Zor çalışma, düzensiz rölanti, güç kaybı ve artan yakıt tüketimi görülebilir.",
      "risk": "İhmal edilirse motorda ciddi hasara yol açabilir; kısa sürede servise gidin ve yağ seviyesini kontrol ettirin."
    },
    "de": {
      "title": "Nockenwelle 'B' Steuerzeiten zu spät (Bank 2)",
      "part": "System der variablen Ventilsteuerung (VVT); oft liegt es am Magnetventil, an der Kettenspannung oder an verschmutztem bzw. zu wenig Motoröl.",
      "symptoms": "Schwerer Motorstart, unruhiger Leerlauf, Leistungsverlust und Mehrverbrauch sind möglich.",
      "risk": "Unbehandelt drohen ernste Motorschäden; bald in die Werkstatt fahren und den Ölstand prüfen lassen."
    }
  },
  "P0026": {
    "tr": {
      "title": "Emme Supabı Kontrol Solenoidi Devre Performansı (Bank 1)",
      "part": "Emme supaplarını yağ basıncıyla ayarlayan solenoid valf veya devresi.",
      "symptoms": "Güç kaybı ve düzensiz motor çalışması olabilir; bazen belirgin bir belirti hissedilmez.",
      "risk": "İhmal edilirse motor performansı ve yakıt ekonomisi kötüleşir; yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Einlassventil-Steuermagnetventil Bereich/Funktion (Bank 1)",
      "part": "Magnetventil, das die Einlassventile über den Öldruck steuert, oder dessen Stromkreis.",
      "symptoms": "Leistungsverlust und unrunder Motorlauf sind möglich; manchmal ist nichts Deutliches spürbar.",
      "risk": "Unbehandelt verschlechtern sich Motorleistung und Verbrauch; zeitnah in die Werkstatt bringen."
    }
  },
  "P0027": {
    "tr": {
      "title": "Egzoz Supabı Kontrol Solenoidi Devre Performansı (Bank 1)",
      "part": "Egzoz supaplarını yağ basıncıyla ayarlayan solenoid valf veya devresi.",
      "symptoms": "Güç kaybı ve düzensiz motor çalışması olabilir; bazen belirgin bir belirti hissedilmez.",
      "risk": "İhmal edilirse motor performansı ve yakıt ekonomisi kötüleşir; yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Auslassventil-Steuermagnetventil Bereich/Funktion (Bank 1)",
      "part": "Magnetventil, das die Auslassventile über den Öldruck steuert, oder dessen Stromkreis.",
      "symptoms": "Leistungsverlust und unrunder Motorlauf sind möglich; manchmal ist nichts Deutliches spürbar.",
      "risk": "Unbehandelt verschlechtern sich Motorleistung und Verbrauch; zeitnah in die Werkstatt bringen."
    }
  },
  "P0030": {
    "tr": {
      "title": "Oksijen Sensörü Isıtıcı Kontrol Devresi (Bank 1 Sensör 1)",
      "part": "Katalizör öncesindeki oksijen (lambda) sensörünün ısıtma elemanı veya kablosu.",
      "symptoms": "Motor arıza lambası yanar; soğuk motorda yakıt tüketimi biraz artabilir, sürüşte genelde fark edilmez.",
      "risk": "Acil değildir ama yakıt tüketimi artar ve egzoz emisyon muayenesinden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Lambdasonden-Heizung Steuerstromkreis (Bank 1 Sonde 1)",
      "part": "Heizelement der Lambdasonde vor dem Katalysator oder deren Verkabelung.",
      "symptoms": "Die Motorkontrollleuchte geht an; bei kaltem Motor kann der Verbrauch leicht steigen, beim Fahren meist kaum spürbar.",
      "risk": "Kein Notfall, aber der Verbrauch steigt und die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0031": {
    "tr": {
      "title": "Oksijen Sensörü Isıtıcı Devresi Düşük (Bank 1 Sensör 1)",
      "part": "Katalizör öncesindeki oksijen (lambda) sensörünün ısıtma elemanı veya kablosu; devrede düşük sinyal/kopukluk var.",
      "symptoms": "Motor arıza lambası yanar; soğuk motorda yakıt tüketimi biraz artabilir, sürüşte genelde fark edilmez.",
      "risk": "Acil değildir ama yakıt tüketimi artar ve egzoz emisyon muayenesinden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Lambdasonden-Heizung Stromkreis zu niedrig (Bank 1 Sonde 1)",
      "part": "Heizelement der Lambdasonde vor dem Katalysator oder deren Verkabelung; das Signal im Stromkreis ist zu niedrig bzw. unterbrochen.",
      "symptoms": "Die Motorkontrollleuchte geht an; bei kaltem Motor kann der Verbrauch leicht steigen, beim Fahren meist kaum spürbar.",
      "risk": "Kein Notfall, aber der Verbrauch steigt und die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0032": {
    "tr": {
      "title": "Oksijen Sensörü Isıtıcı Devresi Yüksek (Bank 1 Sensör 1)",
      "part": "Katalizör öncesindeki oksijen (lambda) sensörünün ısıtma elemanı veya kablosu; devrede yüksek sinyal/kısa devre var.",
      "symptoms": "Motor arıza lambası yanar; soğuk motorda yakıt tüketimi biraz artabilir, sürüşte genelde fark edilmez.",
      "risk": "Acil değildir ama yakıt tüketimi artar ve egzoz emisyon muayenesinden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Lambdasonden-Heizung Stromkreis zu hoch (Bank 1 Sonde 1)",
      "part": "Heizelement der Lambdasonde vor dem Katalysator oder deren Verkabelung; das Signal im Stromkreis ist zu hoch, möglich ist ein Kurzschluss.",
      "symptoms": "Die Motorkontrollleuchte geht an; bei kaltem Motor kann der Verbrauch leicht steigen, beim Fahren meist kaum spürbar.",
      "risk": "Kein Notfall, aber der Verbrauch steigt und die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0033": {
    "tr": {
      "title": "Turbo Bypass Valfi Kontrol Devresi",
      "part": "Turbonun fazla basıncını tahliye eden bypass valfi veya kablosu.",
      "symptoms": "Güç kaybı, turbo basıncında dalgalanma, turbodan ıslık veya tıslama sesi gelebilir.",
      "risk": "İhmal edilirse turboya zarar verebilir ve yakıt tüketimi artar; yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Turbolader-Bypassventil Steuerstromkreis",
      "part": "Bypassventil, das überschüssigen Ladedruck des Turboladers ablässt, oder dessen Verkabelung.",
      "symptoms": "Leistungsverlust, schwankender Ladedruck sowie Pfeif- oder Zischgeräusche vom Turbo sind möglich.",
      "risk": "Unbehandelt kann der Turbolader Schaden nehmen und der Verbrauch steigen; zeitnah in die Werkstatt bringen."
    }
  },
  "P0034": {
    "tr": {
      "title": "Turbo Bypass Valfi Kontrol Devresi Düşük",
      "part": "Turbonun fazla basıncını tahliye eden bypass valfi veya kablosu; devrede düşük sinyal/kopukluk var.",
      "symptoms": "Güç kaybı, turbo basıncında dalgalanma, turbodan ıslık veya tıslama sesi gelebilir.",
      "risk": "İhmal edilirse turboya zarar verebilir ve yakıt tüketimi artar; yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Turbolader-Bypassventil Stromkreis zu niedrig",
      "part": "Bypassventil, das überschüssigen Ladedruck des Turboladers ablässt, oder dessen Verkabelung; das Signal im Stromkreis ist zu niedrig bzw. unterbrochen.",
      "symptoms": "Leistungsverlust, schwankender Ladedruck sowie Pfeif- oder Zischgeräusche vom Turbo sind möglich.",
      "risk": "Unbehandelt kann der Turbolader Schaden nehmen und der Verbrauch steigen; zeitnah in die Werkstatt bringen."
    }
  },
  "P0035": {
    "tr": {
      "title": "Turbo Bypass Valfi Kontrol Devresi Yüksek",
      "part": "Turbonun fazla basıncını tahliye eden bypass valfi veya kablosu; devrede yüksek sinyal/kısa devre var.",
      "symptoms": "Güç kaybı, turbo basıncında dalgalanma, turbodan ıslık veya tıslama sesi gelebilir.",
      "risk": "İhmal edilirse turboya zarar verebilir ve yakıt tüketimi artar; yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Turbolader-Bypassventil Stromkreis zu hoch",
      "part": "Bypassventil, das überschüssigen Ladedruck des Turboladers ablässt, oder dessen Verkabelung; das Signal im Stromkreis ist zu hoch, möglich ist ein Kurzschluss.",
      "symptoms": "Leistungsverlust, schwankender Ladedruck sowie Pfeif- oder Zischgeräusche vom Turbo sind möglich.",
      "risk": "Unbehandelt kann der Turbolader Schaden nehmen und der Verbrauch steigen; zeitnah in die Werkstatt bringen."
    }
  },
  "P0036": {
    "tr": {
      "title": "Oksijen Sensörü Isıtıcı Kontrol Devresi (Bank 1 Sensör 2)",
      "part": "Katalizör sonrasındaki oksijen (lambda) sensörünün ısıtma elemanı veya kablosu.",
      "symptoms": "Motor arıza lambası yanar; sürüşte genellikle hiçbir fark hissedilmez.",
      "risk": "Acil değildir ama egzoz emisyon muayenesinden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Lambdasonden-Heizung Steuerstromkreis (Bank 1 Sonde 2)",
      "part": "Heizelement der Lambdasonde nach dem Katalysator oder deren Verkabelung.",
      "symptoms": "Die Motorkontrollleuchte geht an; beim Fahren ist meist kein Unterschied spürbar.",
      "risk": "Kein Notfall, aber die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0037": {
    "tr": {
      "title": "Oksijen Sensörü Isıtıcı Devresi Düşük (Bank 1 Sensör 2)",
      "part": "Katalizör sonrasındaki oksijen (lambda) sensörünün ısıtma elemanı veya kablosu; devrede düşük sinyal/kopukluk var.",
      "symptoms": "Motor arıza lambası yanar; sürüşte genellikle hiçbir fark hissedilmez.",
      "risk": "Acil değildir ama egzoz emisyon muayenesinden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Lambdasonden-Heizung Stromkreis zu niedrig (Bank 1 Sonde 2)",
      "part": "Heizelement der Lambdasonde nach dem Katalysator oder deren Verkabelung; das Signal im Stromkreis ist zu niedrig bzw. unterbrochen.",
      "symptoms": "Die Motorkontrollleuchte geht an; beim Fahren ist meist kein Unterschied spürbar.",
      "risk": "Kein Notfall, aber die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0038": {
    "tr": {
      "title": "Oksijen Sensörü Isıtıcı Devresi Yüksek (Bank 1 Sensör 2)",
      "part": "Katalizör sonrasındaki oksijen (lambda) sensörünün ısıtma elemanı veya kablosu; devrede yüksek sinyal/kısa devre var.",
      "symptoms": "Motor arıza lambası yanar; sürüşte genellikle hiçbir fark hissedilmez.",
      "risk": "Acil değildir ama egzoz emisyon muayenesinden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Lambdasonden-Heizung Stromkreis zu hoch (Bank 1 Sonde 2)",
      "part": "Heizelement der Lambdasonde nach dem Katalysator oder deren Verkabelung; das Signal im Stromkreis ist zu hoch, möglich ist ein Kurzschluss.",
      "symptoms": "Die Motorkontrollleuchte geht an; beim Fahren ist meist kein Unterschied spürbar.",
      "risk": "Kein Notfall, aber die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0040": {
    "tr": {
      "title": "Oksijen Sensörü Sinyalleri Yer Değişmiş (Bank 1/2 Sensör 1)",
      "part": "İki oksijen (lambda) sensörünün kabloları ters bağlanmış; genellikle bir tamirat sonrasında ortaya çıkar.",
      "symptoms": "Yüksek yakıt tüketimi, düzensiz motor çalışması ve güç kaybı görülebilir.",
      "risk": "Motor yanlış yakıt karışımıyla çalışır ve katalizöre zarar verebilir; kısa sürede servise gidin."
    },
    "de": {
      "title": "Lambdasonden-Signale vertauscht (Bank 1/2 Sonde 1)",
      "part": "Die Kabel zweier Lambdasonden sind vertauscht angeschlossen; das passiert meist nach einer Reparatur.",
      "symptoms": "Hoher Kraftstoffverbrauch, unrunder Motorlauf und Leistungsverlust sind möglich.",
      "risk": "Der Motor läuft mit falschem Gemisch und der Katalysator kann Schaden nehmen; bald in die Werkstatt fahren."
    }
  },
  "P0041": {
    "tr": {
      "title": "Oksijen Sensörü Sinyalleri Yer Değişmiş (Bank 1/2 Sensör 2)",
      "part": "Katalizör sonrasındaki iki oksijen (lambda) sensörünün kabloları ters bağlanmış; genellikle bir tamirat sonrasında ortaya çıkar.",
      "symptoms": "Motor arıza lambası yanar; sürüşte genellikle belirgin bir fark hissedilmez.",
      "risk": "Acil değildir ama katalizör kontrolü doğru çalışmaz ve muayeneden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Lambdasonden-Signale vertauscht (Bank 1/2 Sonde 2)",
      "part": "Die Kabel der beiden Lambdasonden nach dem Katalysator sind vertauscht angeschlossen; das passiert meist nach einer Reparatur.",
      "symptoms": "Die Motorkontrollleuchte geht an; beim Fahren ist meist kein deutlicher Unterschied spürbar.",
      "risk": "Kein Notfall, aber die Katalysator-Überwachung arbeitet falsch und die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0042": {
    "tr": {
      "title": "Oksijen Sensörü Isıtıcı Kontrol Devresi (Bank 1 Sensör 3)",
      "part": "Egzozun en arkasındaki üçüncü oksijen (lambda) sensörünün ısıtma elemanı veya kablosu.",
      "symptoms": "Motor arıza lambası yanar; sürüşte genellikle hiçbir fark hissedilmez.",
      "risk": "Acil değildir ama egzoz emisyon muayenesinden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Lambdasonden-Heizung Steuerstromkreis (Bank 1 Sonde 3)",
      "part": "Heizelement der dritten Lambdasonde ganz hinten im Abgasstrang oder deren Verkabelung.",
      "symptoms": "Die Motorkontrollleuchte geht an; beim Fahren ist meist kein Unterschied spürbar.",
      "risk": "Kein Notfall, aber die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0043": {
    "tr": {
      "title": "Oksijen Sensörü Isıtıcı Devresi Düşük (Bank 1 Sensör 3)",
      "part": "Egzozun en arkasındaki üçüncü oksijen (lambda) sensörünün ısıtma elemanı veya kablosu; devrede düşük sinyal/kopukluk var.",
      "symptoms": "Motor arıza lambası yanar; sürüşte genellikle hiçbir fark hissedilmez.",
      "risk": "Acil değildir ama egzoz emisyon muayenesinden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Lambdasonden-Heizung Stromkreis zu niedrig (Bank 1 Sonde 3)",
      "part": "Heizelement der dritten Lambdasonde ganz hinten im Abgasstrang oder deren Verkabelung; das Signal im Stromkreis ist zu niedrig bzw. unterbrochen.",
      "symptoms": "Die Motorkontrollleuchte geht an; beim Fahren ist meist kein Unterschied spürbar.",
      "risk": "Kein Notfall, aber die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0044": {
    "tr": {
      "title": "Oksijen Sensörü Isıtıcı Devresi Yüksek (Bank 1 Sensör 3)",
      "part": "Egzozun en arkasındaki üçüncü oksijen (lambda) sensörünün ısıtma elemanı veya kablosu; devrede yüksek sinyal/kısa devre var.",
      "symptoms": "Motor arıza lambası yanar; sürüşte genellikle hiçbir fark hissedilmez.",
      "risk": "Acil değildir ama egzoz emisyon muayenesinden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Lambdasonden-Heizung Stromkreis zu hoch (Bank 1 Sonde 3)",
      "part": "Heizelement der dritten Lambdasonde ganz hinten im Abgasstrang oder deren Verkabelung; das Signal im Stromkreis ist zu hoch, möglich ist ein Kurzschluss.",
      "symptoms": "Die Motorkontrollleuchte geht an; beim Fahren ist meist kein Unterschied spürbar.",
      "risk": "Kein Notfall, aber die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0087": {
    "tr": {
      "title": "Yakıt Rayı/Sistemi Basıncı Çok Düşük",
      "part": "Motora yakıt gönderen yüksek basınçlı yakıt sistemi; pompa, yakıt filtresi veya basınç hattı kaynaklı olabilir.",
      "symptoms": "Güç kaybı, gaz verince duraksama, tekleme; araç kendini korumak için gücü kısabilir.",
      "risk": "Araç yolda kalabilir ve enjektörler zarar görebilir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Kraftstoffdruck (Rail/System) zu niedrig",
      "part": "Das Hochdruck-Kraftstoffsystem, das den Motor versorgt; Ursache kann Pumpe, Kraftstofffilter oder Druckleitung sein.",
      "symptoms": "Leistungsverlust, Zögern beim Gasgeben, Ruckeln; das Fahrzeug kann in den Notlauf schalten.",
      "risk": "Gefahr des Liegenbleibens und von Injektorschäden; so schnell wie möglich in die Werkstatt."
    }
  },
  "P0088": {
    "tr": {
      "title": "Yakıt Rayı/Sistemi Basıncı Çok Yüksek",
      "part": "Yakıt basıncını ayarlayan regülatör valfi veya yüksek basınç pompası.",
      "symptoms": "Sert ve gürültülü motor çalışması, arıza lambası; bazen belirgin bir his olmayabilir.",
      "risk": "Aşırı basınç yakıt hatlarına ve enjektörlere zarar verebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kraftstoffdruck (Rail/System) zu hoch",
      "part": "Das Regelventil oder die Hochdruckpumpe, die den Kraftstoffdruck einstellen.",
      "symptoms": "Harter, lauter Motorlauf, Motorkontrollleuchte; manchmal kaum spürbar.",
      "risk": "Zu hoher Druck kann Leitungen und Einspritzdüsen beschädigen; zeitnah in die Werkstatt."
    }
  },
  "P0089": {
    "tr": {
      "title": "Yakıt Basınç Regülatörü 1 Performans Arızası",
      "part": "Yakıt basıncını ayarlayan valf (basınç regülatörü) istenen basıncı tutamıyor.",
      "symptoms": "Düzensiz rölanti, güçte dalgalanma, gaza gecikmeli tepki.",
      "risk": "Motor gücü kısabilir ve yakıt tüketimi artar; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kraftstoffdruckregler 1 – Funktion fehlerhaft",
      "part": "Das Ventil, das den Kraftstoffdruck regelt, hält den Solldruck nicht.",
      "symptoms": "Unruhiger Leerlauf, schwankende Leistung, verzögerte Gasannahme.",
      "risk": "Der Motor kann in den Notlauf gehen und der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0090": {
    "tr": {
      "title": "Yakıt Basınç Regülatörü 1 Kontrol Devresi Arızası",
      "part": "Basınç regülatör valfinin elektrik devresi; kablo, soket veya valfin kendisi.",
      "symptoms": "Zor çalışma, güç kaybı; motor stop edebilir veya güç kısıtlamasına geçebilir.",
      "risk": "Araç yolda kalabilir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Kraftstoffdruckregler 1 – Fehler im Steuerstromkreis",
      "part": "Die elektrische Ansteuerung des Druckregelventils; Kabel, Stecker oder das Ventil selbst.",
      "symptoms": "Startprobleme, Leistungsverlust; der Motor kann ausgehen oder in den Notlauf schalten.",
      "risk": "Gefahr des Liegenbleibens; so schnell wie möglich in die Werkstatt."
    }
  },
  "P0091": {
    "tr": {
      "title": "Yakıt Basınç Regülatörü 1 Kontrol Devresi Düşük Sinyal",
      "part": "Basınç regülatör valfinin elektrik devresinde düşük sinyal; genellikle kablo, soket veya valf sorunu.",
      "symptoms": "Zor çalışma, güç kaybı; motor gücü kısabilir veya stop edebilir.",
      "risk": "Araç yolda kalabilir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Kraftstoffdruckregler 1 – Steuerstromkreis Signal zu niedrig",
      "part": "Zu niedriges Signal im Stromkreis des Druckregelventils; meist Kabel, Stecker oder das Ventil selbst.",
      "symptoms": "Startprobleme, Leistungsverlust; der Motor kann in den Notlauf gehen oder ausgehen.",
      "risk": "Gefahr des Liegenbleibens; so schnell wie möglich in die Werkstatt."
    }
  },
  "P0092": {
    "tr": {
      "title": "Yakıt Basınç Regülatörü 1 Kontrol Devresi Yüksek Sinyal",
      "part": "Basınç regülatör valfinin elektrik devresinde yüksek sinyal; genellikle kablo, soket veya valf sorunu.",
      "symptoms": "Zor çalışma, güç kaybı; motor gücü kısabilir veya stop edebilir.",
      "risk": "Araç yolda kalabilir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Kraftstoffdruckregler 1 – Steuerstromkreis Signal zu hoch",
      "part": "Zu hohes Signal im Stromkreis des Druckregelventils; meist Kabel, Stecker oder das Ventil selbst.",
      "symptoms": "Startprobleme, Leistungsverlust; der Motor kann in den Notlauf gehen oder ausgehen.",
      "risk": "Gefahr des Liegenbleibens; so schnell wie möglich in die Werkstatt."
    }
  },
  "P0093": {
    "tr": {
      "title": "Yakıt Sisteminde Büyük Kaçak Tespit Edildi",
      "part": "Yakıt hatlarında veya bağlantılarında büyük bir sızıntı.",
      "symptoms": "Yakıt kokusu, aracın altında ıslaklık, güç kaybı, hızla düşen yakıt seviyesi.",
      "risk": "Yangın tehlikesi vardır; aracı güvenli bir yerde durdurun, kullanmaya devam etmeyin ve hemen servisi arayın."
    },
    "de": {
      "title": "Kraftstoffsystem – großes Leck erkannt",
      "part": "Ein größeres Leck an den Kraftstoffleitungen oder Anschlüssen.",
      "symptoms": "Kraftstoffgeruch, nasse Stellen unter dem Fahrzeug, Leistungsverlust, schnell sinkender Tankstand.",
      "risk": "Brandgefahr; Fahrzeug sicher abstellen, nicht weiterfahren und sofort die Werkstatt kontaktieren."
    }
  },
  "P0094": {
    "tr": {
      "title": "Yakıt Sisteminde Küçük Kaçak Tespit Edildi",
      "part": "Yakıt hatlarında veya bağlantılarında küçük bir sızıntı.",
      "symptoms": "Hafif yakıt kokusu olabilir; çoğu zaman sadece arıza lambası yanar.",
      "risk": "Kaçak büyüyebilir ve yangın riski oluşturur; en kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kraftstoffsystem – kleines Leck erkannt",
      "part": "Ein kleines Leck an den Kraftstoffleitungen oder Anschlüssen.",
      "symptoms": "Eventuell leichter Kraftstoffgeruch; oft leuchtet nur die Motorkontrollleuchte.",
      "risk": "Das Leck kann größer werden und Brandgefahr entstehen; möglichst bald in die Werkstatt."
    }
  },
  "P0095": {
    "tr": {
      "title": "Emme Havası Sıcaklık Sensörü 2 Devre Arızası",
      "part": "Motora giren havanın sıcaklığını ölçen ikinci sensör (çoğunlukla intercooler tarafında) veya kablosu.",
      "symptoms": "Genellikle sadece arıza lambası; hafif güç kaybı ve tüketim artışı olabilir.",
      "risk": "Acil değildir ancak yakıt tüketimi ve emisyon artar; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Ansauglufttemperatur-Sensor 2 – Fehler im Stromkreis",
      "part": "Der zweite Sensor, der die Temperatur der Ansaugluft misst (meist am Ladeluftkühler), oder seine Verkabelung.",
      "symptoms": "Meist nur die Motorkontrollleuchte; leichter Leistungsverlust und Mehrverbrauch möglich.",
      "risk": "Nicht akut, aber Verbrauch und Abgaswerte verschlechtern sich; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0096": {
    "tr": {
      "title": "Emme Havası Sıcaklık Sensörü 2 Aralık/Performans Arızası",
      "part": "Motora giren havanın sıcaklığını ölçen ikinci sensör mantıksız değer gönderiyor.",
      "symptoms": "Genellikle sadece arıza lambası; hafif performans düşüşü olabilir.",
      "risk": "Acil değildir ancak yakıt tüketimi ve emisyon artar; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Ansauglufttemperatur-Sensor 2 – Signal unplausibel",
      "part": "Der zweite Sensor für die Ansauglufttemperatur liefert unplausible Werte.",
      "symptoms": "Meist nur die Motorkontrollleuchte; leichte Leistungseinbußen möglich.",
      "risk": "Nicht akut, aber Verbrauch und Abgaswerte verschlechtern sich; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0097": {
    "tr": {
      "title": "Emme Havası Sıcaklık Sensörü 2 Düşük Sinyal",
      "part": "İkinci hava sıcaklık sensörünün devresinde düşük sinyal; genellikle sensör veya kablo sorunu.",
      "symptoms": "Genellikle sadece arıza lambası; hafif güç kaybı ve tüketim artışı olabilir.",
      "risk": "Acil değildir ancak yakıt tüketimi ve emisyon artar; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Ansauglufttemperatur-Sensor 2 – Signal zu niedrig",
      "part": "Zu niedriges Signal im Stromkreis des zweiten Ansaugluft-Temperatursensors; meist Sensor oder Kabel defekt.",
      "symptoms": "Meist nur die Motorkontrollleuchte; leichter Leistungsverlust und Mehrverbrauch möglich.",
      "risk": "Nicht akut, aber Verbrauch und Abgaswerte verschlechtern sich; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0098": {
    "tr": {
      "title": "Emme Havası Sıcaklık Sensörü 2 Yüksek Sinyal",
      "part": "İkinci hava sıcaklık sensörünün devresinde yüksek sinyal; genellikle sensör, kablo veya soket sorunu.",
      "symptoms": "Genellikle sadece arıza lambası; hafif güç kaybı ve tüketim artışı olabilir.",
      "risk": "Acil değildir ancak yakıt tüketimi ve emisyon artar; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Ansauglufttemperatur-Sensor 2 – Signal zu hoch",
      "part": "Zu hohes Signal im Stromkreis des zweiten Ansaugluft-Temperatursensors; meist Sensor, Kabel oder Stecker defekt.",
      "symptoms": "Meist nur die Motorkontrollleuchte; leichter Leistungsverlust und Mehrverbrauch möglich.",
      "risk": "Nicht akut, aber Verbrauch und Abgaswerte verschlechtern sich; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0100": {
    "tr": {
      "title": "Hava Kütle Sensörü (MAF) Devre Arızası",
      "part": "Motora giren havayı ölçen sensör (MAF) veya kablosu.",
      "symptoms": "Yüksek yakıt tüketimi, güç kaybı, düzensiz rölanti.",
      "risk": "Uzun vadede katalizör ve partikül filtresi zarar görebilir, yakıt maliyeti artar; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Luftmassenmesser (LMM) – Fehler im Stromkreis",
      "part": "Der Sensor, der die angesaugte Luftmenge misst, oder seine Verkabelung.",
      "symptoms": "Hoher Kraftstoffverbrauch, Leistungsverlust, unruhiger Leerlauf.",
      "risk": "Auf Dauer drohen Schäden an Katalysator und Partikelfilter sowie Mehrverbrauch; zeitnah in die Werkstatt."
    }
  },
  "P0101": {
    "tr": {
      "title": "Hava Kütle Sensörü (MAF) Aralık/Performans Arızası",
      "part": "Hava ölçüm sensörü (MAF) mantıksız değer gönderiyor; sensör kirlenmiş veya emme hattında hava kaçağı olabilir.",
      "symptoms": "Güç kaybı, düzensiz rölanti, yüksek tüketim; egzozdan siyah duman gelebilir.",
      "risk": "Tüketim artar ve uzun vadede egzoz sistemi zarar görebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Luftmassenmesser (LMM) – Signal unplausibel",
      "part": "Der Luftmassenmesser liefert unplausible Werte; er kann verschmutzt sein oder das Ansaugsystem hat ein Luftleck.",
      "symptoms": "Leistungsverlust, unruhiger Leerlauf, Mehrverbrauch; eventuell schwarzer Rauch aus dem Auspuff.",
      "risk": "Der Verbrauch steigt und die Abgasanlage kann auf Dauer Schaden nehmen; zeitnah in die Werkstatt."
    }
  },
  "P0102": {
    "tr": {
      "title": "Hava Kütle Sensörü (MAF) Düşük Sinyal",
      "part": "Hava ölçüm sensörünün (MAF) devresinde düşük sinyal; genellikle sensör, kablo veya soket sorunu.",
      "symptoms": "Güç kaybı, düzensiz rölanti, yüksek tüketim; motor gücü kısabilir.",
      "risk": "Tüketim artar ve sürüş performansı düşer; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Luftmassenmesser (LMM) – Signal zu niedrig",
      "part": "Zu niedriges Signal im Stromkreis des Luftmassenmessers; meist Sensor, Kabel oder Stecker defekt.",
      "symptoms": "Leistungsverlust, unruhiger Leerlauf, Mehrverbrauch; der Motor kann in den Notlauf gehen.",
      "risk": "Der Verbrauch steigt und die Fahrleistung sinkt; zeitnah in die Werkstatt."
    }
  },
  "P0103": {
    "tr": {
      "title": "Hava Kütle Sensörü (MAF) Yüksek Sinyal",
      "part": "Hava ölçüm sensörünün (MAF) devresinde yüksek sinyal; genellikle sensör, kablo veya soket sorunu.",
      "symptoms": "Güç kaybı, düzensiz rölanti, yüksek tüketim; motor gücü kısabilir.",
      "risk": "Tüketim artar ve sürüş performansı düşer; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Luftmassenmesser (LMM) – Signal zu hoch",
      "part": "Zu hohes Signal im Stromkreis des Luftmassenmessers; meist Sensor, Kabel oder Stecker defekt.",
      "symptoms": "Leistungsverlust, unruhiger Leerlauf, Mehrverbrauch; der Motor kann in den Notlauf gehen.",
      "risk": "Der Verbrauch steigt und die Fahrleistung sinkt; zeitnah in die Werkstatt."
    }
  },
  "P0104": {
    "tr": {
      "title": "Hava Kütle Sensörü (MAF) Kesintili Sinyal",
      "part": "Hava ölçüm sensörünün (MAF) sinyali zaman zaman kesiliyor; genellikle gevşek soket veya kablo sorunu.",
      "symptoms": "Ara ara sarsıntı ve güç kaybı; belirtiler bir görünüp bir kaybolabilir.",
      "risk": "Arıza aniden kötüleşebilir ve tüketim artar; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Luftmassenmesser (LMM) – Signal zeitweise unterbrochen",
      "part": "Das Signal des Luftmassenmessers fällt zeitweise aus; meist ein lockerer Stecker oder ein Kabelproblem.",
      "symptoms": "Gelegentliches Ruckeln und Leistungsverlust; die Symptome kommen und gehen.",
      "risk": "Der Fehler kann sich plötzlich verschlimmern und der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0105": {
    "tr": {
      "title": "Emme Manifoldu Basınç Sensörü (MAP) Devre Arızası",
      "part": "Emme manifoldundaki hava basıncını ölçen sensör (MAP) veya kablosu.",
      "symptoms": "Güç kaybı, sarsıntılı çalışma, yüksek tüketim; egzozdan duman gelebilir.",
      "risk": "Tüketim artar ve uzun vadede egzoz sistemi zarar görebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Saugrohrdrucksensor (MAP) – Fehler im Stromkreis",
      "part": "Der Sensor, der den Luftdruck im Ansaugtrakt misst, oder seine Verkabelung.",
      "symptoms": "Leistungsverlust, ruckelnder Motorlauf, Mehrverbrauch; eventuell Rauch aus dem Auspuff.",
      "risk": "Der Verbrauch steigt und die Abgasanlage kann auf Dauer Schaden nehmen; zeitnah in die Werkstatt."
    }
  },
  "P0106": {
    "tr": {
      "title": "Emme Manifoldu Basınç Sensörü (MAP) Aralık/Performans Arızası",
      "part": "Basınç sensörü (MAP) mantıksız değer gönderiyor; sensör, hortumu veya emme hattında kaçak olabilir.",
      "symptoms": "Güç kaybı, düzensiz rölanti, yüksek tüketim.",
      "risk": "Tüketim artar ve performans düşer; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Saugrohrdrucksensor (MAP) – Signal unplausibel",
      "part": "Der Drucksensor liefert unplausible Werte; Ursache kann der Sensor, sein Schlauch oder ein Leck im Ansaugtrakt sein.",
      "symptoms": "Leistungsverlust, unruhiger Leerlauf, Mehrverbrauch.",
      "risk": "Der Verbrauch steigt und die Leistung sinkt; zeitnah in die Werkstatt."
    }
  },
  "P0107": {
    "tr": {
      "title": "Emme Manifoldu Basınç Sensörü (MAP) Düşük Sinyal",
      "part": "Basınç sensörünün (MAP) devresinde düşük sinyal; genellikle sensör, kablo veya soket sorunu.",
      "symptoms": "Güç kaybı, zor çalışma, düzensiz rölanti; motor gücü kısabilir.",
      "risk": "Tüketim artar ve performans düşer; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Saugrohrdrucksensor (MAP) – Signal zu niedrig",
      "part": "Zu niedriges Signal im Stromkreis des Drucksensors; meist Sensor, Kabel oder Stecker defekt.",
      "symptoms": "Leistungsverlust, Startprobleme, unruhiger Leerlauf; der Motor kann in den Notlauf gehen.",
      "risk": "Der Verbrauch steigt und die Leistung sinkt; zeitnah in die Werkstatt."
    }
  },
  "P0108": {
    "tr": {
      "title": "Emme Manifoldu Basınç Sensörü (MAP) Yüksek Sinyal",
      "part": "Basınç sensörünün (MAP) devresinde yüksek sinyal; genellikle sensör, kablo veya soket sorunu.",
      "symptoms": "Güç kaybı, zor çalışma, düzensiz rölanti; motor gücü kısabilir.",
      "risk": "Tüketim artar ve performans düşer; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Saugrohrdrucksensor (MAP) – Signal zu hoch",
      "part": "Zu hohes Signal im Stromkreis des Drucksensors; meist Sensor, Kabel oder Stecker defekt.",
      "symptoms": "Leistungsverlust, Startprobleme, unruhiger Leerlauf; der Motor kann in den Notlauf gehen.",
      "risk": "Der Verbrauch steigt und die Leistung sinkt; zeitnah in die Werkstatt."
    }
  },
  "P0109": {
    "tr": {
      "title": "Emme Manifoldu Basınç Sensörü (MAP) Kesintili Sinyal",
      "part": "Basınç sensörünün (MAP) sinyali zaman zaman kesiliyor; genellikle gevşek soket veya kablo sorunu.",
      "symptoms": "Ara ara sarsıntı ve güç kaybı; belirtiler bir görünüp bir kaybolabilir.",
      "risk": "Arıza aniden kötüleşebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Saugrohrdrucksensor (MAP) – Signal zeitweise unterbrochen",
      "part": "Das Signal des Drucksensors fällt zeitweise aus; meist ein lockerer Stecker oder ein Kabelproblem.",
      "symptoms": "Gelegentliches Ruckeln und Leistungsverlust; die Symptome kommen und gehen.",
      "risk": "Der Fehler kann sich plötzlich verschlimmern; zeitnah in die Werkstatt."
    }
  },
  "P0110": {
    "tr": {
      "title": "Emme Havası Sıcaklık Sensörü 1 Devre Arızası",
      "part": "Motora giren havanın sıcaklığını ölçen sensör veya kablosu.",
      "symptoms": "Özellikle soğukta zor çalışma, hafif tüketim artışı; çoğu zaman sadece arıza lambası yanar.",
      "risk": "Acil değildir ancak yakıt tüketimi ve emisyon artar; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Ansauglufttemperatur-Sensor 1 – Fehler im Stromkreis",
      "part": "Der Sensor, der die Temperatur der angesaugten Luft misst, oder seine Verkabelung.",
      "symptoms": "Startprobleme vor allem bei Kälte, leichter Mehrverbrauch; oft leuchtet nur die Motorkontrollleuchte.",
      "risk": "Nicht akut, aber Verbrauch und Abgaswerte verschlechtern sich; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0111": {
    "tr": {
      "title": "Emme Havası Sıcaklık Sensörü 1 Aralık/Performans Arızası",
      "part": "Hava sıcaklık sensörü mantıksız değer gönderiyor; sensör veya kablo sorunu olabilir.",
      "symptoms": "Genellikle sadece arıza lambası; hafif tüketim artışı olabilir.",
      "risk": "Acil değildir ancak yakıt tüketimi ve emisyon artar; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Ansauglufttemperatur-Sensor 1 – Signal unplausibel",
      "part": "Der Ansaugluft-Temperatursensor liefert unplausible Werte; Ursache kann der Sensor oder das Kabel sein.",
      "symptoms": "Meist nur die Motorkontrollleuchte; leichter Mehrverbrauch möglich.",
      "risk": "Nicht akut, aber Verbrauch und Abgaswerte verschlechtern sich; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0112": {
    "tr": {
      "title": "Emme Havası Sıcaklık Sensörü 1 Düşük Sinyal",
      "part": "Hava sıcaklık sensörünün devresinde düşük sinyal; genellikle sensör veya kablo sorunu.",
      "symptoms": "Hafif güç kaybı ve tüketim artışı olabilir; çoğu zaman sadece arıza lambası yanar.",
      "risk": "Acil değildir ancak yakıt tüketimi ve emisyon artar; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Ansauglufttemperatur-Sensor 1 – Signal zu niedrig",
      "part": "Zu niedriges Signal im Stromkreis des Ansaugluft-Temperatursensors; meist Sensor oder Kabel defekt.",
      "symptoms": "Leichter Leistungsverlust und Mehrverbrauch möglich; oft leuchtet nur die Motorkontrollleuchte.",
      "risk": "Nicht akut, aber Verbrauch und Abgaswerte verschlechtern sich; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0113": {
    "tr": {
      "title": "Emme Havası Sıcaklık Sensörü 1 Yüksek Sinyal",
      "part": "Hava sıcaklık sensörünün devresinde yüksek sinyal; genellikle sensör, kablo veya kopuk bağlantı.",
      "symptoms": "Soğukta zor çalışma, hafif tüketim artışı; çoğu zaman sadece arıza lambası yanar.",
      "risk": "Acil değildir ancak yakıt tüketimi ve emisyon artar; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Ansauglufttemperatur-Sensor 1 – Signal zu hoch",
      "part": "Zu hohes Signal im Stromkreis des Ansaugluft-Temperatursensors; meist Sensor, Kabel oder eine unterbrochene Verbindung.",
      "symptoms": "Startprobleme bei Kälte, leichter Mehrverbrauch; oft leuchtet nur die Motorkontrollleuchte.",
      "risk": "Nicht akut, aber Verbrauch und Abgaswerte verschlechtern sich; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0114": {
    "tr": {
      "title": "Emme Havası Sıcaklık Sensörü 1 Kesintili Sinyal",
      "part": "Hava sıcaklık sensörünün sinyali zaman zaman kesiliyor; genellikle gevşek soket veya kablo sorunu.",
      "symptoms": "Belirtiler gelip gidebilir; ara ara düzensiz çalışma ve arıza lambası.",
      "risk": "Acil değildir ancak arıza kalıcı hale gelebilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Ansauglufttemperatur-Sensor 1 – Signal zeitweise unterbrochen",
      "part": "Das Signal des Ansaugluft-Temperatursensors fällt zeitweise aus; meist ein lockerer Stecker oder ein Kabelproblem.",
      "symptoms": "Die Symptome kommen und gehen; zeitweise unruhiger Motorlauf und Motorkontrollleuchte.",
      "risk": "Nicht akut, aber der Fehler kann dauerhaft werden; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0115": {
    "tr": {
      "title": "Motor Soğutma Suyu Sıcaklık Sensörü Devre Arızası",
      "part": "Motor suyunun (antifriz) sıcaklığını ölçen sensör veya kablosu.",
      "symptoms": "Zor çalışma, yüksek tüketim; fan sürekli dönebilir, sıcaklık göstergesi yanlış gösterebilir.",
      "risk": "Motorun hararet yaptığı fark edilmeyebilir ve ciddi hasar oluşabilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kühlmitteltemperatur-Sensor – Fehler im Stromkreis",
      "part": "Der Sensor, der die Temperatur des Motorkühlwassers misst, oder seine Verkabelung.",
      "symptoms": "Startprobleme, Mehrverbrauch; der Lüfter kann dauerhaft laufen, die Temperaturanzeige kann falsch anzeigen.",
      "risk": "Eine Überhitzung des Motors kann unbemerkt bleiben und schwere Schäden verursachen; zeitnah in die Werkstatt."
    }
  },
  "P0116": {
    "tr": {
      "title": "Motor Soğutma Suyu Sıcaklık Sensörü Aralık/Performans Arızası",
      "part": "Su sıcaklık sensörü mantıksız değer gönderiyor; sensör veya termostat kaynaklı olabilir.",
      "symptoms": "Motor geç ısınabilir, tüketim artar; gösterge yanlış sıcaklık gösterebilir.",
      "risk": "Hararet fark edilmeyebilir ve motor zarar görebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kühlmitteltemperatur-Sensor – Signal unplausibel",
      "part": "Der Kühlmittel-Temperatursensor liefert unplausible Werte; Ursache kann der Sensor oder das Thermostat sein.",
      "symptoms": "Der Motor wird eventuell nur langsam warm, der Verbrauch steigt; die Anzeige kann falsche Werte zeigen.",
      "risk": "Eine Überhitzung kann unbemerkt bleiben und den Motor schädigen; zeitnah in die Werkstatt."
    }
  },
  "P0117": {
    "tr": {
      "title": "Motor Soğutma Suyu Sıcaklık Sensörü Düşük Sinyal",
      "part": "Su sıcaklık sensörünün devresinde düşük sinyal; genellikle sensör, kablo veya kısa devre.",
      "symptoms": "Fan sürekli dönebilir, zor çalışma ve yüksek tüketim; gösterge yanlış gösterebilir.",
      "risk": "Motorun gerçek sıcaklığı bilinemez, hararet fark edilmeyebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kühlmitteltemperatur-Sensor – Signal zu niedrig",
      "part": "Zu niedriges Signal im Stromkreis des Kühlmittel-Temperatursensors; meist Sensor, Kabel oder ein Kurzschluss.",
      "symptoms": "Der Lüfter kann dauerhaft laufen, Startprobleme und Mehrverbrauch; die Anzeige kann falsch anzeigen.",
      "risk": "Die echte Motortemperatur ist unbekannt, eine Überhitzung kann unbemerkt bleiben; zeitnah in die Werkstatt."
    }
  },
  "P0118": {
    "tr": {
      "title": "Motor Soğutma Suyu Sıcaklık Sensörü Yüksek Sinyal",
      "part": "Su sıcaklık sensörünün devresinde yüksek sinyal; genellikle sensör, kablo veya kopuk bağlantı.",
      "symptoms": "Zor çalışma (özellikle soğukta), yüksek tüketim; fan sürekli dönebilir.",
      "risk": "Motorun gerçek sıcaklığı bilinemez, hararet fark edilmeyebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kühlmitteltemperatur-Sensor – Signal zu hoch",
      "part": "Zu hohes Signal im Stromkreis des Kühlmittel-Temperatursensors; meist Sensor, Kabel oder eine unterbrochene Verbindung.",
      "symptoms": "Startprobleme vor allem bei Kälte, Mehrverbrauch; der Lüfter kann dauerhaft laufen.",
      "risk": "Die echte Motortemperatur ist unbekannt, eine Überhitzung kann unbemerkt bleiben; zeitnah in die Werkstatt."
    }
  },
  "P0119": {
    "tr": {
      "title": "Motor Soğutma Suyu Sıcaklık Sensörü Kesintili Sinyal",
      "part": "Su sıcaklık sensörünün sinyali zaman zaman kesiliyor; genellikle gevşek soket veya kablo sorunu.",
      "symptoms": "Belirtiler gelip gidebilir; ara ara zor çalışma, fanın gereksiz dönmesi ve arıza lambası.",
      "risk": "Hararet fark edilmeyebilir ve arıza kalıcı hale gelebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kühlmitteltemperatur-Sensor – Signal zeitweise unterbrochen",
      "part": "Das Signal des Kühlmittel-Temperatursensors fällt zeitweise aus; meist ein lockerer Stecker oder ein Kabelproblem.",
      "symptoms": "Die Symptome kommen und gehen; zeitweise Startprobleme, unnötig laufender Lüfter und Motorkontrollleuchte.",
      "risk": "Eine Überhitzung kann unbemerkt bleiben und der Fehler kann dauerhaft werden; zeitnah in die Werkstatt."
    }
  },
  "P0120": {
    "tr": {
      "title": "Gaz Kelebeği/Pedal Konum Sensörü A Devre Arızası",
      "part": "Gaz pedalına ne kadar bastığınızı motora ileten sensör veya kablo bağlantısı.",
      "symptoms": "Gaza basınca gecikmeli veya ani tepki, düzensiz rölanti, aracın kendini güç kısıtlamasına (emniyet moduna) alması.",
      "risk": "Araç aniden güç kaybedebilir, bu trafikte tehlikelidir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Drosselklappen-/Pedalsensor A – Fehler im Stromkreis",
      "part": "Der Sensor oder seine Verkabelung, der dem Motor meldet, wie weit das Gaspedal gedrückt ist.",
      "symptoms": "Verzögerte oder ruckartige Gasannahme, unruhiger Leerlauf, Fahrzeug schaltet in den Notlauf.",
      "risk": "Plötzlicher Leistungsverlust ist im Verkehr gefährlich; so bald wie möglich in die Werkstatt."
    }
  },
  "P0121": {
    "tr": {
      "title": "Gaz Kelebeği/Pedal Konum Sensörü A Aralık/Performans Sorunu",
      "part": "Gaz pedalı konumunu ölçen sensör; beklenen aralığın dışında değer gönderiyor.",
      "symptoms": "Düzensiz gaz tepkisi, dalgalanan rölanti, hızlanmada takılma veya güç kaybı.",
      "risk": "Araç emniyet moduna geçip gücü kısabilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Drosselklappen-/Pedalsensor A – Bereichs-/Funktionsfehler",
      "part": "Der Sensor für die Gaspedalstellung; er liefert Werte außerhalb des erwarteten Bereichs.",
      "symptoms": "Unregelmäßige Gasannahme, schwankender Leerlauf, Ruckeln oder Leistungsverlust beim Beschleunigen.",
      "risk": "Das Fahrzeug kann in den Notlauf gehen und die Leistung begrenzen; zeitnah in die Werkstatt."
    }
  },
  "P0122": {
    "tr": {
      "title": "Gaz Kelebeği/Pedal Konum Sensörü A Düşük Sinyal",
      "part": "Gaz pedalı konum sensörü veya kablosu; sinyal olması gerekenden düşük (muhtemel kablo/soket sorunu).",
      "symptoms": "Gaza basınca tepki yok veya çok zayıf, motor rölanti devrinde takılı kalabilir, emniyet modu.",
      "risk": "Araç aniden güç kaybedebilir ve trafikte tehlike yaratır; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Drosselklappen-/Pedalsensor A – Signal zu niedrig",
      "part": "Der Gaspedal-Positionssensor oder seine Verkabelung; das Signal ist zu niedrig (oft Kabel- oder Steckerproblem).",
      "symptoms": "Kaum oder keine Reaktion auf das Gaspedal, Motor bleibt eventuell im Leerlauf hängen, Notlauf.",
      "risk": "Plötzlicher Leistungsverlust ist im Verkehr gefährlich; so bald wie möglich in die Werkstatt."
    }
  },
  "P0123": {
    "tr": {
      "title": "Gaz Kelebeği/Pedal Konum Sensörü A Yüksek Sinyal",
      "part": "Gaz pedalı konum sensörü veya kablosu; sinyal olması gerekenden yüksek (muhtemel kablo/soket sorunu).",
      "symptoms": "Düzensiz veya ani gaz tepkisi, yüksek rölanti, aracın emniyet moduna geçmesi.",
      "risk": "Motor gücü aniden kısılabilir veya kontrolsüz tepki verebilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Drosselklappen-/Pedalsensor A – Signal zu hoch",
      "part": "Der Gaspedal-Positionssensor oder seine Verkabelung; das Signal ist zu hoch (oft Kabel- oder Steckerproblem).",
      "symptoms": "Unregelmäßige oder abrupte Gasannahme, erhöhter Leerlauf, Fahrzeug schaltet in den Notlauf.",
      "risk": "Die Motorleistung kann plötzlich begrenzt werden oder unkontrolliert reagieren; so bald wie möglich in die Werkstatt."
    }
  },
  "P0124": {
    "tr": {
      "title": "Gaz Kelebeği/Pedal Konum Sensörü A Kesintili Sinyal",
      "part": "Gaz pedalı konum sensörü; sinyal ara ara kesiliyor (genelde gevşek soket veya yıpranmış kablo).",
      "symptoms": "Sürüş sırasında ara ara sarsılma, ani devir değişimi, arıza lambasının yanıp sönmesi.",
      "risk": "Arıza gelip gittiği için tehlikeli anlarda güç kaybı yaşanabilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Drosselklappen-/Pedalsensor A – Signal zeitweise unterbrochen",
      "part": "Der Gaspedal-Positionssensor; das Signal fällt zeitweise aus (meist lockerer Stecker oder verschlissenes Kabel).",
      "symptoms": "Gelegentliches Ruckeln während der Fahrt, plötzliche Drehzahlsprünge, Motorleuchte geht an und aus.",
      "risk": "Da der Fehler sporadisch auftritt, kann die Leistung im falschen Moment wegbrechen; zeitnah in die Werkstatt."
    }
  },
  "P0125": {
    "tr": {
      "title": "Yakıt Regülasyonu İçin Yetersiz Motor Sıcaklığı",
      "part": "Motor soğutma sistemi (genelde termostat) veya motor sıcaklık sensörü; motor yeterince ısınmıyor.",
      "symptoms": "Motor geç ısınır, kalorifer zayıf ısıtır, sıcaklık göstergesi düşük kalır, yakıt tüketimi artar.",
      "risk": "Acil değil, ancak yakıt tüketimi artar ve motor aşınması hızlanır; yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Kühlmitteltemperatur zu niedrig für Kraftstoffregelung",
      "part": "Das Kühlsystem des Motors (meist das Thermostat) oder der Temperatursensor; der Motor wird nicht richtig warm.",
      "symptoms": "Motor braucht lange zum Warmwerden, Heizung heizt schwach, Temperaturanzeige bleibt niedrig, höherer Verbrauch.",
      "risk": "Nicht akut gefährlich, aber der Verbrauch steigt und der Motor verschleißt schneller; bald in die Werkstatt."
    }
  },
  "P0126": {
    "tr": {
      "title": "Kararlı Çalışma İçin Yetersiz Motor Sıcaklığı",
      "part": "Motor soğutma sistemi (genelde termostat) veya sıcaklık sensörü; motor normal çalışma sıcaklığına ulaşamıyor.",
      "symptoms": "Motor geç ısınır, kalorifer zayıf ısıtır, yakıt tüketimi artar; sürüşte büyük fark hissedilmeyebilir.",
      "risk": "Acil değil, ancak yakıt maliyeti artar ve emisyon yükselir; yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Kühlmitteltemperatur zu niedrig für stabilen Betrieb",
      "part": "Das Kühlsystem des Motors (meist das Thermostat) oder der Temperatursensor; der Motor erreicht die normale Betriebstemperatur nicht.",
      "symptoms": "Motor wird nur langsam warm, Heizung heizt schwach, höherer Verbrauch; beim Fahren oft kaum spürbar.",
      "risk": "Nicht akut, aber Kraftstoffkosten und Abgaswerte steigen; bald in die Werkstatt."
    }
  },
  "P0128": {
    "tr": {
      "title": "Termostat Arızası (Motor Sıcaklığı Beklenenden Düşük)",
      "part": "Motorun çalışma sıcaklığını ayarlayan termostat; büyük olasılıkla açık konumda takılı kalmış.",
      "symptoms": "Sıcaklık göstergesi düşük kalır, kalorifer geç ve zayıf ısıtır, yakıt tüketimi artar.",
      "risk": "Uzun vadede yakıt maliyeti ve motor aşınması artar; birkaç gün içinde servise gösterilmeli."
    },
    "de": {
      "title": "Thermostat – Kühlmitteltemperatur unter Solltemperatur",
      "part": "Das Thermostat, das die Betriebstemperatur des Motors regelt; es klemmt wahrscheinlich in offener Stellung.",
      "symptoms": "Temperaturanzeige bleibt niedrig, Heizung wird nur langsam und schwach warm, höherer Verbrauch.",
      "risk": "Auf Dauer steigen Kraftstoffkosten und Motorverschleiß; innerhalb weniger Tage in die Werkstatt."
    }
  },
  "P0130": {
    "tr": {
      "title": "O2 (Lambda) Sensörü Devre Arızası (Bank 1, Sensör 1)",
      "part": "Katalizörün önündeki oksijen (lambda) sensörü veya kablosu; egzozdaki oksijeni ölçüp yakıt karışımını ayarlatır.",
      "symptoms": "Yakıt tüketiminde artış, düzensiz rölanti, hafif güç kaybı; arıza lambası yanar.",
      "risk": "Yakıt tüketimi artar ve katalizör zamanla zarar görebilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 1) – Fehler im Stromkreis",
      "part": "Die Lambdasonde vor dem Katalysator oder ihre Verkabelung; sie misst den Sauerstoff im Abgas und steuert das Kraftstoffgemisch.",
      "symptoms": "Höherer Kraftstoffverbrauch, unruhiger Leerlauf, leichter Leistungsverlust; Motorleuchte an.",
      "risk": "Der Verbrauch steigt und der Katalysator kann mit der Zeit Schaden nehmen; zeitnah in die Werkstatt."
    }
  },
  "P0131": {
    "tr": {
      "title": "O2 Sensörü Düşük Voltaj (Bank 1, Sensör 1)",
      "part": "Katalizörün önündeki oksijen (lambda) sensörü; sinyali sürekli düşük, karışım fakir okunuyor veya kabloda sorun var.",
      "symptoms": "Güç kaybı, düzensiz çalışma, yakıt tüketiminde artış; arıza lambası yanar.",
      "risk": "Motor yanlış karışımla çalışır, tüketim artar ve katalizör zarar görebilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 1) – Spannung zu niedrig",
      "part": "Die Lambdasonde vor dem Katalysator; das Signal ist dauerhaft zu niedrig, das Gemisch wirkt zu mager oder die Verkabelung ist defekt.",
      "symptoms": "Leistungsverlust, unrunder Motorlauf, höherer Kraftstoffverbrauch; Motorleuchte an.",
      "risk": "Der Motor läuft mit falschem Gemisch, der Verbrauch steigt und der Katalysator kann Schaden nehmen; zeitnah in die Werkstatt."
    }
  },
  "P0132": {
    "tr": {
      "title": "O2 Sensörü Yüksek Voltaj (Bank 1, Sensör 1)",
      "part": "Katalizörün önündeki oksijen (lambda) sensörü; sinyali sürekli yüksek, karışım zengin okunuyor veya kabloda sorun var.",
      "symptoms": "Yakıt tüketiminde artış, egzozdan yakıt kokusu veya koyu duman, düzensiz rölanti.",
      "risk": "Fazla yakıt katalizöre zarar verebilir ve maliyeti artırır; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 1) – Spannung zu hoch",
      "part": "Die Lambdasonde vor dem Katalysator; das Signal ist dauerhaft zu hoch, das Gemisch wirkt zu fett oder die Verkabelung ist defekt.",
      "symptoms": "Höherer Kraftstoffverbrauch, Kraftstoffgeruch oder dunkler Rauch aus dem Auspuff, unruhiger Leerlauf.",
      "risk": "Zu viel Kraftstoff kann den Katalysator beschädigen und erhöht die Kosten; zeitnah in die Werkstatt."
    }
  },
  "P0133": {
    "tr": {
      "title": "O2 Sensörü Yavaş Tepki (Bank 1, Sensör 1)",
      "part": "Katalizörün önündeki oksijen (lambda) sensörü; yaşlanmış veya kirlenmiş, değişimlere geç tepki veriyor.",
      "symptoms": "Genelde belirgin bir sürüş farkı yoktur; yakıt tüketimi hafif artabilir, arıza lambası yanar.",
      "risk": "Acil değil, ancak tüketim ve emisyon artar, muayeneden kalınabilir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 1) – reagiert zu langsam",
      "part": "Die Lambdasonde vor dem Katalysator; sie ist gealtert oder verschmutzt und reagiert zu träge auf Veränderungen.",
      "symptoms": "Beim Fahren meist kaum spürbar; der Verbrauch kann leicht steigen, Motorleuchte an.",
      "risk": "Nicht akut, aber Verbrauch und Abgaswerte steigen, die HU kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0134": {
    "tr": {
      "title": "O2 Sensörü Sinyal Yok (Bank 1, Sensör 1)",
      "part": "Katalizörün önündeki oksijen (lambda) sensörü; hiç sinyal göndermiyor (sensör ölmüş veya kablo kopuk olabilir).",
      "symptoms": "Yakıt tüketiminde belirgin artış, düzensiz çalışma olabilir; arıza lambası yanar.",
      "risk": "Motor karışımı ayarlanamaz, tüketim artar ve katalizör zarar görebilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 1) – keine Aktivität erkannt",
      "part": "Die Lambdasonde vor dem Katalysator; sie liefert gar kein Signal (Sonde defekt oder Kabel unterbrochen).",
      "symptoms": "Deutlich höherer Kraftstoffverbrauch, eventuell unrunder Motorlauf; Motorleuchte an.",
      "risk": "Das Gemisch kann nicht geregelt werden, der Verbrauch steigt und der Katalysator kann Schaden nehmen; zeitnah in die Werkstatt."
    }
  },
  "P0135": {
    "tr": {
      "title": "O2 Sensörü Isıtıcı Devresi Arızası (Bank 1, Sensör 1)",
      "part": "Katalizör önündeki oksijen (lambda) sensörünün ısıtıcısı; sensörü hızla çalışma sıcaklığına getirir.",
      "symptoms": "Özellikle soğuk çalıştırmada yüksek yakıt tüketimi; sürüşte genelde fark edilmez, arıza lambası yanar.",
      "risk": "Acil değil, ancak tüketim ve emisyon artar; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonden-Heizung (Bank 1, Sonde 1) – Fehler",
      "part": "Die Heizung der Lambdasonde vor dem Katalysator; sie bringt die Sonde schnell auf Betriebstemperatur.",
      "symptoms": "Vor allem beim Kaltstart höherer Verbrauch; beim Fahren meist nicht spürbar, Motorleuchte an.",
      "risk": "Nicht akut, aber Verbrauch und Abgaswerte steigen; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0136": {
    "tr": {
      "title": "O2 (Lambda) Sensörü Devre Arızası (Bank 1, Sensör 2)",
      "part": "Katalizörün arkasındaki oksijen (lambda) sensörü veya kablosu; katalizörün doğru çalışıp çalışmadığını denetler.",
      "symptoms": "Sürüşte genelde fark edilmez; arıza lambası yanar.",
      "risk": "Katalizör arızası fark edilmeden ilerleyebilir, emisyon testinden kalınabilir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 2) – Fehler im Stromkreis",
      "part": "Die Lambdasonde hinter dem Katalysator oder ihre Verkabelung; sie überwacht, ob der Katalysator richtig arbeitet.",
      "symptoms": "Beim Fahren meist nicht spürbar; Motorleuchte an.",
      "risk": "Ein Katalysatorschaden kann unbemerkt bleiben, die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0137": {
    "tr": {
      "title": "O2 Sensörü Düşük Voltaj (Bank 1, Sensör 2)",
      "part": "Katalizörün arkasındaki oksijen (lambda) sensörü; sinyali sürekli düşük (sensör veya kablo sorunu olabilir).",
      "symptoms": "Sürüşte genelde fark edilmez; arıza lambası yanar.",
      "risk": "Katalizör denetimi çalışmaz, emisyon testinden kalınabilir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 2) – Spannung zu niedrig",
      "part": "Die Lambdasonde hinter dem Katalysator; das Signal ist dauerhaft zu niedrig (Sonde oder Verkabelung defekt).",
      "symptoms": "Beim Fahren meist nicht spürbar; Motorleuchte an.",
      "risk": "Die Katalysatorüberwachung funktioniert nicht, die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0138": {
    "tr": {
      "title": "O2 Sensörü Yüksek Voltaj (Bank 1, Sensör 2)",
      "part": "Katalizörün arkasındaki oksijen (lambda) sensörü; sinyali sürekli yüksek (sensör, kablo veya zengin karışım).",
      "symptoms": "Sürüşte genelde fark edilmez; yakıt tüketimi hafif artabilir, arıza lambası yanar.",
      "risk": "Katalizör denetimi bozulur ve altta yatan bir karışım sorunu gizlenebilir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 2) – Spannung zu hoch",
      "part": "Die Lambdasonde hinter dem Katalysator; das Signal ist dauerhaft zu hoch (Sonde, Kabel oder zu fettes Gemisch).",
      "symptoms": "Beim Fahren meist nicht spürbar; der Verbrauch kann leicht steigen, Motorleuchte an.",
      "risk": "Die Katalysatorüberwachung ist gestört und ein Gemischproblem kann unbemerkt bleiben; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0139": {
    "tr": {
      "title": "O2 Sensörü Yavaş Tepki (Bank 1, Sensör 2)",
      "part": "Katalizörün arkasındaki oksijen (lambda) sensörü; yaşlanmış veya kirlenmiş, değişimlere geç tepki veriyor.",
      "symptoms": "Sürüşte fark edilmez; arıza lambası yanar.",
      "risk": "Acil değil, ancak katalizör denetimi güvenilmez hale gelir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 2) – reagiert zu langsam",
      "part": "Die Lambdasonde hinter dem Katalysator; sie ist gealtert oder verschmutzt und reagiert zu träge.",
      "symptoms": "Beim Fahren nicht spürbar; Motorleuchte an.",
      "risk": "Nicht akut, aber die Katalysatorüberwachung wird unzuverlässig; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0140": {
    "tr": {
      "title": "O2 Sensörü Sinyal Yok (Bank 1, Sensör 2)",
      "part": "Katalizörün arkasındaki oksijen (lambda) sensörü; hiç sinyal göndermiyor (sensör ölmüş veya kablo kopuk olabilir).",
      "symptoms": "Sürüşte genelde fark edilmez; arıza lambası yanar.",
      "risk": "Katalizör denetlenemez, emisyon testinden kalınabilir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 2) – keine Aktivität erkannt",
      "part": "Die Lambdasonde hinter dem Katalysator; sie liefert gar kein Signal (Sonde defekt oder Kabel unterbrochen).",
      "symptoms": "Beim Fahren meist nicht spürbar; Motorleuchte an.",
      "risk": "Der Katalysator kann nicht überwacht werden, die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0141": {
    "tr": {
      "title": "O2 Sensörü Isıtıcı Devresi Arızası (Bank 1, Sensör 2)",
      "part": "Katalizör arkasındaki oksijen (lambda) sensörünün ısıtıcısı; sensörü hızla çalışma sıcaklığına getirir.",
      "symptoms": "Sürüşte fark edilmez; arıza lambası yanar.",
      "risk": "Acil değil, ancak emisyon denetimi gecikir ve muayeneden kalınabilir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonden-Heizung (Bank 1, Sonde 2) – Fehler",
      "part": "Die Heizung der Lambdasonde hinter dem Katalysator; sie bringt die Sonde schnell auf Betriebstemperatur.",
      "symptoms": "Beim Fahren nicht spürbar; Motorleuchte an.",
      "risk": "Nicht akut, aber die Abgasüberwachung verzögert sich und die HU kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0142": {
    "tr": {
      "title": "O2 (Lambda) Sensörü Devre Arızası (Bank 1, Sensör 3)",
      "part": "Egzoz hattındaki üçüncü oksijen (lambda) sensörü veya kablosu (ikinci katalizörün arkasında; her araçta bulunmaz).",
      "symptoms": "Sürüşte genelde fark edilmez; arıza lambası yanar.",
      "risk": "Egzoz temizleme sistemi denetlenemez, emisyon testinden kalınabilir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 3) – Fehler im Stromkreis",
      "part": "Die dritte Lambdasonde in der Abgasanlage oder ihre Verkabelung (hinter dem zweiten Katalysator; nicht in jedem Fahrzeug vorhanden).",
      "symptoms": "Beim Fahren meist nicht spürbar; Motorleuchte an.",
      "risk": "Die Abgasreinigung kann nicht überwacht werden, die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0143": {
    "tr": {
      "title": "O2 Sensörü Düşük Voltaj (Bank 1, Sensör 3)",
      "part": "Egzoz hattındaki üçüncü oksijen (lambda) sensörü; sinyali sürekli düşük (sensör veya kablo sorunu olabilir).",
      "symptoms": "Sürüşte fark edilmez; arıza lambası yanar.",
      "risk": "Acil değil, ancak emisyon denetimi bozulur; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 3) – Spannung zu niedrig",
      "part": "Die dritte Lambdasonde in der Abgasanlage; das Signal ist dauerhaft zu niedrig (Sonde oder Verkabelung defekt).",
      "symptoms": "Beim Fahren nicht spürbar; Motorleuchte an.",
      "risk": "Nicht akut, aber die Abgasüberwachung ist gestört; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0144": {
    "tr": {
      "title": "O2 Sensörü Yüksek Voltaj (Bank 1, Sensör 3)",
      "part": "Egzoz hattındaki üçüncü oksijen (lambda) sensörü; sinyali sürekli yüksek (sensör veya kablo sorunu olabilir).",
      "symptoms": "Sürüşte fark edilmez; arıza lambası yanar.",
      "risk": "Acil değil, ancak emisyon denetimi bozulur; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 3) – Spannung zu hoch",
      "part": "Die dritte Lambdasonde in der Abgasanlage; das Signal ist dauerhaft zu hoch (Sonde oder Verkabelung defekt).",
      "symptoms": "Beim Fahren nicht spürbar; Motorleuchte an.",
      "risk": "Nicht akut, aber die Abgasüberwachung ist gestört; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0145": {
    "tr": {
      "title": "O2 Sensörü Yavaş Tepki (Bank 1, Sensör 3)",
      "part": "Egzoz hattındaki üçüncü oksijen (lambda) sensörü; yaşlanmış veya kirlenmiş, değişimlere geç tepki veriyor.",
      "symptoms": "Sürüşte fark edilmez; arıza lambası yanar.",
      "risk": "Acil değil, ancak emisyon denetimi güvenilmez hale gelir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 3) – reagiert zu langsam",
      "part": "Die dritte Lambdasonde in der Abgasanlage; sie ist gealtert oder verschmutzt und reagiert zu träge.",
      "symptoms": "Beim Fahren nicht spürbar; Motorleuchte an.",
      "risk": "Nicht akut, aber die Abgasüberwachung wird unzuverlässig; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0146": {
    "tr": {
      "title": "O2 Sensörü Sinyal Yok (Bank 1, Sensör 3)",
      "part": "Egzoz hattındaki üçüncü oksijen (lambda) sensörü; hiç sinyal göndermiyor (sensör ölmüş veya kablo kopuk olabilir).",
      "symptoms": "Sürüşte fark edilmez; arıza lambası yanar.",
      "risk": "Acil değil, ancak emisyon denetimi çalışmaz ve muayeneden kalınabilir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 1, Sonde 3) – keine Aktivität erkannt",
      "part": "Die dritte Lambdasonde in der Abgasanlage; sie liefert gar kein Signal (Sonde defekt oder Kabel unterbrochen).",
      "symptoms": "Beim Fahren nicht spürbar; Motorleuchte an.",
      "risk": "Nicht akut, aber die Abgasüberwachung fällt aus und die HU kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0147": {
    "tr": {
      "title": "O2 Sensörü Isıtıcı Devresi Arızası (Bank 1, Sensör 3)",
      "part": "Egzoz hattındaki üçüncü oksijen (lambda) sensörünün ısıtıcısı; sensörü hızla çalışma sıcaklığına getirir.",
      "symptoms": "Sürüşte fark edilmez; arıza lambası yanar.",
      "risk": "Acil değil, ancak emisyon denetimi gecikir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonden-Heizung (Bank 1, Sonde 3) – Fehler",
      "part": "Die Heizung der dritten Lambdasonde in der Abgasanlage; sie bringt die Sonde schnell auf Betriebstemperatur.",
      "symptoms": "Beim Fahren nicht spürbar; Motorleuchte an.",
      "risk": "Nicht akut, aber die Abgasüberwachung verzögert sich; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0150": {
    "tr": {
      "title": "O2 (Oksijen) Sensörü Devre Arızası (Bank 2, Sensör 1)",
      "part": "Motorun 2. silindir sırasında, katalizörden önce egzozdaki oksijeni ölçen sensör veya kablosu.",
      "symptoms": "Yüksek yakıt tüketimi, düzensiz rölanti, hafif güç kaybı; motor arıza lambası yanar.",
      "risk": "İhmal edilirse yakıt maliyeti artar ve katalizör zarar görebilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 2, Sensor 1) – Fehler im Stromkreis",
      "part": "Die Lambdasonde vor dem Katalysator auf Zylinderbank 2, die den Sauerstoff im Abgas misst, oder ihre Verkabelung.",
      "symptoms": "Erhöhter Kraftstoffverbrauch, unruhiger Leerlauf, leichter Leistungsverlust; Motorkontrollleuchte leuchtet.",
      "risk": "Wird es ignoriert, steigen die Spritkosten und der Katalysator kann Schaden nehmen; zeitnah in die Werkstatt."
    }
  },
  "P0151": {
    "tr": {
      "title": "O2 Sensörü Düşük Voltaj (Bank 2, Sensör 1)",
      "part": "Katalizörden önceki oksijen sensörü (Bank 2) çok düşük sinyal gönderiyor; sensör veya kablosu arızalı olabilir.",
      "symptoms": "Yüksek yakıt tüketimi, tekleme, güç kaybı hissedilebilir; arıza lambası yanar.",
      "risk": "Yakıt karışımı yanlış ayarlanır; uzun vadede katalizör hasarı ve artan yakıt maliyeti; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 2, Sensor 1) – Spannung zu niedrig",
      "part": "Die Lambdasonde vor dem Katalysator auf Bank 2 liefert ein zu niedriges Signal; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Erhöhter Verbrauch, Ruckeln, spürbarer Leistungsverlust möglich; Motorkontrollleuchte leuchtet.",
      "risk": "Das Kraftstoffgemisch wird falsch geregelt; auf Dauer drohen Katalysatorschaden und höhere Spritkosten; zeitnah zur Werkstatt."
    }
  },
  "P0152": {
    "tr": {
      "title": "O2 Sensörü Yüksek Voltaj (Bank 2, Sensör 1)",
      "part": "Katalizörden önceki oksijen sensörü (Bank 2) çok yüksek sinyal gönderiyor; sensör veya kablosu arızalı olabilir.",
      "symptoms": "Yakıt tüketimi artar, egzozdan koku veya duman gelebilir, rölanti düzensizleşebilir; arıza lambası yanar.",
      "risk": "Zengin karışım katalizöre zarar verebilir ve yakıt maliyetini artırır; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 2, Sensor 1) – Spannung zu hoch",
      "part": "Die Lambdasonde vor dem Katalysator auf Bank 2 liefert ein zu hohes Signal; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Höherer Verbrauch, möglicher Abgasgeruch oder Rauch, unruhiger Leerlauf; Motorkontrollleuchte leuchtet.",
      "risk": "Ein zu fettes Gemisch kann den Katalysator beschädigen und erhöht die Spritkosten; zeitnah zur Werkstatt."
    }
  },
  "P0153": {
    "tr": {
      "title": "O2 Sensörü Yavaş Tepki (Bank 2, Sensör 1)",
      "part": "Katalizörden önceki oksijen sensörü (Bank 2) yaşlanmış veya kirlenmiş; değişimlere geç tepki veriyor.",
      "symptoms": "Genellikle sadece arıza lambası yanar; hafif yakıt tüketimi artışı fark edilebilir.",
      "risk": "Acil değildir ancak tüketimi artırır ve emisyon muayenesinden kalınabilir; planlı bir serviste değiştirilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 2, Sensor 1) – träge Reaktion",
      "part": "Die Lambdasonde vor dem Katalysator auf Bank 2 ist gealtert oder verschmutzt und reagiert zu langsam.",
      "symptoms": "Meist leuchtet nur die Motorkontrollleuchte; ein leicht erhöhter Verbrauch kann auffallen.",
      "risk": "Nicht akut, erhöht aber den Verbrauch und kann die Abgasuntersuchung scheitern lassen; beim nächsten Werkstatttermin tauschen lassen."
    }
  },
  "P0154": {
    "tr": {
      "title": "O2 Sensörü Sinyal Yok (Bank 2, Sensör 1)",
      "part": "Katalizörden önceki oksijen sensöründen (Bank 2) hiç sinyal gelmiyor; sensör ölmüş veya kablo kopmuş olabilir.",
      "symptoms": "Yüksek yakıt tüketimi, düzensiz çalışma olabilir; arıza lambası yanar.",
      "risk": "Motor karışımı körlemesine ayarlar; tüketim artar ve katalizör zarar görebilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 2, Sensor 1) – keine Aktivität",
      "part": "Von der Lambdasonde vor dem Katalysator auf Bank 2 kommt kein Signal; Sensor defekt oder Kabel unterbrochen.",
      "symptoms": "Erhöhter Verbrauch und unrunder Motorlauf möglich; Motorkontrollleuchte leuchtet.",
      "risk": "Der Motor regelt das Gemisch blind; Verbrauch steigt und der Katalysator kann Schaden nehmen; zeitnah zur Werkstatt."
    }
  },
  "P0155": {
    "tr": {
      "title": "O2 Sensörü Isıtıcı Devre Arızası (Bank 2, Sensör 1)",
      "part": "Katalizörden önceki oksijen sensörünün (Bank 2) ısıtıcı devresi veya sigortası/kablosu arızalı.",
      "symptoms": "Özellikle soğuk çalıştırmada yüksek tüketim; sürüş genellikle normal hissedilir, arıza lambası yanar.",
      "risk": "Acil değildir ama soğukken tüketimi artırır ve muayenede sorun çıkarır; ilk fırsatta servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonden-Heizung (Bank 2, Sensor 1) – Stromkreisfehler",
      "part": "Die Heizung der Lambdasonde vor dem Katalysator auf Bank 2 oder deren Sicherung/Verkabelung ist defekt.",
      "symptoms": "Vor allem beim Kaltstart erhöhter Verbrauch; das Fahren fühlt sich meist normal an, Motorkontrollleuchte leuchtet.",
      "risk": "Nicht akut, erhöht aber den Verbrauch im kalten Zustand und macht Probleme bei der Abgasuntersuchung; bei Gelegenheit zur Werkstatt."
    }
  },
  "P0156": {
    "tr": {
      "title": "O2 Sensörü Devre Arızası (Bank 2, Sensör 2)",
      "part": "Katalizörden sonra egzozu ölçen ve katalizörün çalışmasını denetleyen sensör (Bank 2) veya kablosu.",
      "symptoms": "Sürüşte genellikle fark hissedilmez; motor arıza lambası yanar.",
      "risk": "Acil değildir ancak katalizör denetimi çalışmaz ve emisyon muayenesinden kalınabilir; ilk fırsatta servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 2, Sensor 2) – Fehler im Stromkreis",
      "part": "Die Lambdasonde nach dem Katalysator auf Bank 2, die dessen Funktion überwacht, oder ihre Verkabelung.",
      "symptoms": "Beim Fahren meist nicht spürbar; die Motorkontrollleuchte leuchtet.",
      "risk": "Nicht akut, aber die Katalysator-Überwachung fällt aus und die Abgasuntersuchung kann scheitern; bei Gelegenheit zur Werkstatt."
    }
  },
  "P0157": {
    "tr": {
      "title": "O2 Sensörü Düşük Voltaj (Bank 2, Sensör 2)",
      "part": "Katalizörden sonraki oksijen sensörü (Bank 2) çok düşük sinyal gönderiyor; sensör veya kablosu arızalı olabilir.",
      "symptoms": "Sürüşte genellikle fark hissedilmez; motor arıza lambası yanar.",
      "risk": "Acil değildir ancak katalizör sorunu gizlenebilir ve muayeneden kalınabilir; ilk fırsatta servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 2, Sensor 2) – Spannung zu niedrig",
      "part": "Die Lambdasonde nach dem Katalysator auf Bank 2 liefert ein zu niedriges Signal; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Beim Fahren meist nicht spürbar; die Motorkontrollleuchte leuchtet.",
      "risk": "Nicht akut, kann aber Katalysatorprobleme verdecken und die Abgasuntersuchung scheitern lassen; bei Gelegenheit zur Werkstatt."
    }
  },
  "P0158": {
    "tr": {
      "title": "O2 Sensörü Yüksek Voltaj (Bank 2, Sensör 2)",
      "part": "Katalizörden sonraki oksijen sensörü (Bank 2) çok yüksek sinyal gönderiyor; sensör veya kablosu arızalı olabilir.",
      "symptoms": "Sürüşte genellikle fark hissedilmez; motor arıza lambası yanar.",
      "risk": "Acil değildir ancak katalizör denetimi bozulur ve muayeneden kalınabilir; ilk fırsatta servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 2, Sensor 2) – Spannung zu hoch",
      "part": "Die Lambdasonde nach dem Katalysator auf Bank 2 liefert ein zu hohes Signal; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Beim Fahren meist nicht spürbar; die Motorkontrollleuchte leuchtet.",
      "risk": "Nicht akut, aber die Katalysator-Überwachung ist gestört und die Abgasuntersuchung kann scheitern; bei Gelegenheit zur Werkstatt."
    }
  },
  "P0159": {
    "tr": {
      "title": "O2 Sensörü Yavaş Tepki (Bank 2, Sensör 2)",
      "part": "Katalizörden sonraki oksijen sensörü (Bank 2) yaşlanmış veya kirlenmiş; değişimlere geç tepki veriyor.",
      "symptoms": "Sürüşte genellikle fark hissedilmez; motor arıza lambası yanar.",
      "risk": "Acil değildir; emisyon denetimi etkilenir, planlı bir serviste kontrol ettirilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 2, Sensor 2) – träge Reaktion",
      "part": "Die Lambdasonde nach dem Katalysator auf Bank 2 ist gealtert oder verschmutzt und reagiert zu langsam.",
      "symptoms": "Beim Fahren meist nicht spürbar; die Motorkontrollleuchte leuchtet.",
      "risk": "Nicht akut; die Abgasüberwachung ist beeinträchtigt, beim nächsten Werkstatttermin prüfen lassen."
    }
  },
  "P0160": {
    "tr": {
      "title": "O2 Sensörü Sinyal Yok (Bank 2, Sensör 2)",
      "part": "Katalizörden sonraki oksijen sensöründen (Bank 2) hiç sinyal gelmiyor; sensör ölmüş veya kablo kopmuş olabilir.",
      "symptoms": "Sürüşte genellikle fark hissedilmez; motor arıza lambası yanar.",
      "risk": "Acil değildir ancak katalizör denetimi tamamen devre dışı kalır; ilk fırsatta servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonde (Bank 2, Sensor 2) – keine Aktivität",
      "part": "Von der Lambdasonde nach dem Katalysator auf Bank 2 kommt kein Signal; Sensor defekt oder Kabel unterbrochen.",
      "symptoms": "Beim Fahren meist nicht spürbar; die Motorkontrollleuchte leuchtet.",
      "risk": "Nicht akut, aber die Katalysator-Überwachung fällt komplett aus; bei Gelegenheit zur Werkstatt."
    }
  },
  "P0161": {
    "tr": {
      "title": "O2 Sensörü Isıtıcı Devre Arızası (Bank 2, Sensör 2)",
      "part": "Katalizörden sonraki oksijen sensörünün (Bank 2) ısıtıcı devresi veya sigortası/kablosu arızalı.",
      "symptoms": "Sürüşte genellikle fark hissedilmez; motor arıza lambası yanar.",
      "risk": "Acil değildir; ancak emisyon denetimi gecikir ve muayenede sorun çıkabilir; ilk fırsatta servise gösterilmeli."
    },
    "de": {
      "title": "Lambdasonden-Heizung (Bank 2, Sensor 2) – Stromkreisfehler",
      "part": "Die Heizung der Lambdasonde nach dem Katalysator auf Bank 2 oder deren Sicherung/Verkabelung ist defekt.",
      "symptoms": "Beim Fahren meist nicht spürbar; die Motorkontrollleuchte leuchtet.",
      "risk": "Nicht akut; die Abgasüberwachung startet verzögert und die Abgasuntersuchung kann Probleme machen; bei Gelegenheit zur Werkstatt."
    }
  },
  "P0170": {
    "tr": {
      "title": "Yakıt Karışımı Ayar Arızası (Bank 1)",
      "part": "Motorun yakıt-hava karışımını ayarlayan sistem; sebep genellikle hava kaçağı, sensör arızası veya yakıt beslemesidir.",
      "symptoms": "Düzensiz rölanti, güç kaybı, yakıt tüketiminde artış hissedilebilir.",
      "risk": "Yanlış karışım uzun vadede motora ve katalizöre zarar verir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Gemischregelung (Bank 1) – Fehlfunktion",
      "part": "Das System, das das Kraftstoff-Luft-Gemisch regelt; Ursache ist oft Falschluft, ein Sensorfehler oder die Kraftstoffversorgung.",
      "symptoms": "Unruhiger Leerlauf, Leistungsverlust und erhöhter Verbrauch können auftreten.",
      "risk": "Ein falsches Gemisch schadet auf Dauer Motor und Katalysator; zeitnah zur Werkstatt."
    }
  },
  "P0171": {
    "tr": {
      "title": "Karışım Çok Fakir (Bank 1)",
      "part": "Motor gereğinden az yakıtla çalışıyor; sebep genellikle hava kaçağı, hava sensörü veya yakıt basıncı düşüklüğüdür.",
      "symptoms": "Güç kaybı, tekleme, düzensiz rölanti, zor çalışma hissedilebilir.",
      "risk": "Fakir karışım motoru aşırı ısıtabilir ve zamanla ciddi hasara yol açar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Gemisch zu mager (Bank 1)",
      "part": "Der Motor läuft mit zu wenig Kraftstoff; Ursache ist oft Falschluft, der Luftmassenmesser oder zu niedriger Kraftstoffdruck.",
      "symptoms": "Leistungsverlust, Ruckeln, unruhiger Leerlauf und schlechtes Anspringen sind möglich.",
      "risk": "Ein zu mageres Gemisch kann den Motor überhitzen und mit der Zeit ernsthaft beschädigen; zeitnah zur Werkstatt."
    }
  },
  "P0172": {
    "tr": {
      "title": "Karışım Çok Zengin (Bank 1)",
      "part": "Motor gereğinden fazla yakıtla çalışıyor; sebep genellikle sensör arızası, enjektör veya yakıt basıncı sorunudur.",
      "symptoms": "Yüksek yakıt tüketimi, siyah egzoz dumanı, yakıt kokusu, düzensiz rölanti görülebilir.",
      "risk": "Katalizör ve bujiler kısa sürede zarar görebilir, yakıt maliyeti hızla artar; geciktirmeden servise gidilmeli."
    },
    "de": {
      "title": "Gemisch zu fett (Bank 1)",
      "part": "Der Motor läuft mit zu viel Kraftstoff; Ursache ist oft ein Sensorfehler, ein Einspritzventil oder der Kraftstoffdruck.",
      "symptoms": "Hoher Verbrauch, schwarzer Rauch aus dem Auspuff, Kraftstoffgeruch und unruhiger Leerlauf sind möglich.",
      "risk": "Katalysator und Zündkerzen können schnell Schaden nehmen, die Spritkosten steigen deutlich; ohne Verzögerung zur Werkstatt."
    }
  },
  "P0173": {
    "tr": {
      "title": "Yakıt Karışımı Ayar Arızası (Bank 2)",
      "part": "Motorun 2. silindir sırasında yakıt-hava karışımını ayarlayan sistem; sebep genellikle hava kaçağı, sensör veya yakıt beslemesidir.",
      "symptoms": "Düzensiz rölanti, güç kaybı, yakıt tüketiminde artış hissedilebilir.",
      "risk": "Yanlış karışım uzun vadede motora ve katalizöre zarar verir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Gemischregelung (Bank 2) – Fehlfunktion",
      "part": "Das System, das das Kraftstoff-Luft-Gemisch auf Zylinderbank 2 regelt; Ursache ist oft Falschluft, ein Sensorfehler oder die Kraftstoffversorgung.",
      "symptoms": "Unruhiger Leerlauf, Leistungsverlust und erhöhter Verbrauch können auftreten.",
      "risk": "Ein falsches Gemisch schadet auf Dauer Motor und Katalysator; zeitnah zur Werkstatt."
    }
  },
  "P0174": {
    "tr": {
      "title": "Karışım Çok Fakir (Bank 2)",
      "part": "Motorun 2. silindir sırası gereğinden az yakıtla çalışıyor; sebep genellikle hava kaçağı, hava sensörü veya düşük yakıt basıncıdır.",
      "symptoms": "Güç kaybı, tekleme, düzensiz rölanti, zor çalışma hissedilebilir.",
      "risk": "Fakir karışım motoru aşırı ısıtabilir ve zamanla ciddi hasara yol açar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Gemisch zu mager (Bank 2)",
      "part": "Zylinderbank 2 läuft mit zu wenig Kraftstoff; Ursache ist oft Falschluft, der Luftmassenmesser oder zu niedriger Kraftstoffdruck.",
      "symptoms": "Leistungsverlust, Ruckeln, unruhiger Leerlauf und schlechtes Anspringen sind möglich.",
      "risk": "Ein zu mageres Gemisch kann den Motor überhitzen und mit der Zeit ernsthaft beschädigen; zeitnah zur Werkstatt."
    }
  },
  "P0175": {
    "tr": {
      "title": "Karışım Çok Zengin (Bank 2)",
      "part": "Motorun 2. silindir sırası gereğinden fazla yakıtla çalışıyor; sebep genellikle sensör, enjektör veya yakıt basıncı sorunudur.",
      "symptoms": "Yüksek yakıt tüketimi, siyah egzoz dumanı, yakıt kokusu, düzensiz rölanti görülebilir.",
      "risk": "Katalizör ve bujiler kısa sürede zarar görebilir, yakıt maliyeti hızla artar; geciktirmeden servise gidilmeli."
    },
    "de": {
      "title": "Gemisch zu fett (Bank 2)",
      "part": "Zylinderbank 2 läuft mit zu viel Kraftstoff; Ursache ist oft ein Sensorfehler, ein Einspritzventil oder der Kraftstoffdruck.",
      "symptoms": "Hoher Verbrauch, schwarzer Rauch aus dem Auspuff, Kraftstoffgeruch und unruhiger Leerlauf sind möglich.",
      "risk": "Katalysator und Zündkerzen können schnell Schaden nehmen, die Spritkosten steigen deutlich; ohne Verzögerung zur Werkstatt."
    }
  },
  "P0180": {
    "tr": {
      "title": "Yakıt Sıcaklık Sensörü A Devre Arızası",
      "part": "Yakıtın sıcaklığını ölçen sensör veya kablosu.",
      "symptoms": "Çoğu zaman belirgin belirti olmaz; zor çalışma veya hafif tüketim artışı görülebilir, arıza lambası yanar.",
      "risk": "Genellikle acil değildir; ancak yakıt hesaplaması etkilenir, ilk fırsatta kontrol ettirilmeli."
    },
    "de": {
      "title": "Kraftstofftemperatursensor A – Stromkreisfehler",
      "part": "Der Sensor, der die Temperatur des Kraftstoffs misst, oder seine Verkabelung.",
      "symptoms": "Meist keine deutlichen Anzeichen; schlechteres Anspringen oder leicht erhöhter Verbrauch möglich, Motorkontrollleuchte leuchtet.",
      "risk": "In der Regel nicht akut; die Kraftstoffberechnung wird aber ungenau, bei Gelegenheit prüfen lassen."
    }
  },
  "P0181": {
    "tr": {
      "title": "Yakıt Sıcaklık Sensörü A Sinyal Tutarsız",
      "part": "Yakıt sıcaklığını ölçen sensör mantıksız veya tutarsız değer gönderiyor.",
      "symptoms": "Çoğu zaman belirgin belirti olmaz; zor çalışma veya düzensiz çalışma görülebilir, arıza lambası yanar.",
      "risk": "Genellikle acil değildir; ancak yakıt hesaplaması bozulabilir, ilk fırsatta kontrol ettirilmeli."
    },
    "de": {
      "title": "Kraftstofftemperatursensor A – unplausibles Signal",
      "part": "Der Sensor für die Kraftstofftemperatur liefert unplausible oder schwankende Werte.",
      "symptoms": "Meist keine deutlichen Anzeichen; schlechteres Anspringen oder unrunder Lauf möglich, Motorkontrollleuchte leuchtet.",
      "risk": "In der Regel nicht akut; die Kraftstoffberechnung kann aber gestört werden, bei Gelegenheit prüfen lassen."
    }
  },
  "P0182": {
    "tr": {
      "title": "Yakıt Sıcaklık Sensörü A Düşük Sinyal",
      "part": "Yakıt sıcaklığını ölçen sensörden çok düşük sinyal geliyor; sensör veya kablosu arızalı olabilir.",
      "symptoms": "Çoğu zaman belirgin belirti olmaz; soğukta zor çalışma veya hafif tüketim artışı olabilir, arıza lambası yanar.",
      "risk": "Genellikle acil değildir; ilk fırsatta servise gösterilmeli."
    },
    "de": {
      "title": "Kraftstofftemperatursensor A – Signal zu niedrig",
      "part": "Vom Kraftstofftemperatursensor kommt ein zu niedriges Signal; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Meist keine deutlichen Anzeichen; schlechteres Anspringen bei Kälte oder leicht erhöhter Verbrauch möglich, Motorkontrollleuchte leuchtet.",
      "risk": "In der Regel nicht akut; bei Gelegenheit in der Werkstatt prüfen lassen."
    }
  },
  "P0183": {
    "tr": {
      "title": "Yakıt Sıcaklık Sensörü A Yüksek Sinyal",
      "part": "Yakıt sıcaklığını ölçen sensörden çok yüksek sinyal geliyor; sensör veya kablosu arızalı olabilir.",
      "symptoms": "Çoğu zaman belirgin belirti olmaz; zor çalışma veya hafif tüketim artışı olabilir, arıza lambası yanar.",
      "risk": "Genellikle acil değildir; ilk fırsatta servise gösterilmeli."
    },
    "de": {
      "title": "Kraftstofftemperatursensor A – Signal zu hoch",
      "part": "Vom Kraftstofftemperatursensor kommt ein zu hohes Signal; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Meist keine deutlichen Anzeichen; schlechteres Anspringen oder leicht erhöhter Verbrauch möglich, Motorkontrollleuchte leuchtet.",
      "risk": "In der Regel nicht akut; bei Gelegenheit in der Werkstatt prüfen lassen."
    }
  },
  "P0190": {
    "tr": {
      "title": "Yakıt Ray Basınç Sensörü Devre Arızası",
      "part": "Enjektörlere giden yakıtın basıncını ölçen sensör (common rail) veya kablosu.",
      "symptoms": "Güç kaybı, tekleme, zor çalıştırma; araç emniyet (yavaş) moduna geçebilir veya stop edebilir.",
      "risk": "Motor yolda stop edebilir ya da hiç çalışmayabilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Kraftstoffdrucksensor (Rail) – Stromkreisfehler",
      "part": "Der Sensor, der den Druck des Kraftstoffs zu den Einspritzdüsen misst (Common Rail), oder seine Verkabelung.",
      "symptoms": "Leistungsverlust, Ruckeln, schlechtes Anspringen; das Fahrzeug kann ins Notlaufprogramm gehen oder ausgehen.",
      "risk": "Der Motor kann unterwegs ausgehen oder gar nicht mehr anspringen; so schnell wie möglich zur Werkstatt."
    }
  },
  "P0191": {
    "tr": {
      "title": "Yakıt Ray Basınç Sensörü Sinyal Tutarsız",
      "part": "Yakıt basıncını ölçen sensör (common rail) mantıksız veya tutarsız değer gönderiyor.",
      "symptoms": "Güç kaybı, düzensiz çalışma, zor çalıştırma; araç emniyet moduna geçebilir.",
      "risk": "Motor performansı düşer ve araç yolda kalabilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Kraftstoffdrucksensor (Rail) – unplausibles Signal",
      "part": "Der Kraftstoffdrucksensor (Common Rail) liefert unplausible oder schwankende Werte.",
      "symptoms": "Leistungsverlust, unrunder Lauf, schlechtes Anspringen; das Fahrzeug kann ins Notlaufprogramm gehen.",
      "risk": "Die Motorleistung sinkt und das Fahrzeug kann liegen bleiben; so schnell wie möglich zur Werkstatt."
    }
  },
  "P0192": {
    "tr": {
      "title": "Yakıt Ray Basınç Sensörü Düşük Sinyal",
      "part": "Yakıt basıncını ölçen sensörden (common rail) çok düşük sinyal geliyor; sensör veya kablosu arızalı olabilir.",
      "symptoms": "Güç kaybı, tekleme, zor çalıştırma; araç emniyet moduna geçebilir veya stop edebilir.",
      "risk": "Motor yolda stop edebilir ya da çalışmayabilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Kraftstoffdrucksensor (Rail) – Signal zu niedrig",
      "part": "Vom Kraftstoffdrucksensor (Common Rail) kommt ein zu niedriges Signal; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Leistungsverlust, Ruckeln, schlechtes Anspringen; das Fahrzeug kann ins Notlaufprogramm gehen oder ausgehen.",
      "risk": "Der Motor kann unterwegs ausgehen oder nicht mehr anspringen; so schnell wie möglich zur Werkstatt."
    }
  },
  "P0193": {
    "tr": {
      "title": "Yakıt Ray Basınç Sensörü Yüksek Sinyal",
      "part": "Yakıt basıncını ölçen sensörden (common rail) çok yüksek sinyal geliyor; sensör veya kablosu arızalı olabilir.",
      "symptoms": "Güç kaybı, düzensiz çalışma, zor çalıştırma; araç emniyet moduna geçebilir.",
      "risk": "Motor performansı düşer ve araç yolda kalabilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Kraftstoffdrucksensor (Rail) – Signal zu hoch",
      "part": "Vom Kraftstoffdrucksensor (Common Rail) kommt ein zu hohes Signal; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Leistungsverlust, unrunder Lauf, schlechtes Anspringen; das Fahrzeug kann ins Notlaufprogramm gehen.",
      "risk": "Die Motorleistung sinkt und das Fahrzeug kann liegen bleiben; so schnell wie möglich zur Werkstatt."
    }
  },
  "P0194": {
    "tr": {
      "title": "Yakıt Ray Basınç Sensörü Kesintili Sinyal",
      "part": "Yakıt basıncını ölçen sensörün (common rail) sinyali zaman zaman kesiliyor; genellikle gevşek soket veya kablo sorunu.",
      "symptoms": "Ara ara tekleme, ani güç kaybı veya stop etme görülebilir; arıza gelip gidebilir.",
      "risk": "Arıza aniden büyüyebilir ve araç yolda kalabilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Kraftstoffdrucksensor (Rail) – zeitweiliger Fehler",
      "part": "Das Signal des Kraftstoffdrucksensors (Common Rail) fällt zeitweise aus; oft ein lockerer Stecker oder ein Kabelproblem.",
      "symptoms": "Gelegentliches Ruckeln, plötzlicher Leistungsverlust oder Absterben des Motors möglich; der Fehler kann kommen und gehen.",
      "risk": "Der Fehler kann sich plötzlich verschlimmern und das Fahrzeug liegen bleiben; so schnell wie möglich zur Werkstatt."
    }
  },
  "P0200": {
    "tr": {
      "title": "Enjektör Devresi Arızası",
      "part": "Motora yakıt püskürten enjektörlerin elektrik devresi veya kablo bağlantısı.",
      "symptoms": "Motorda tekleme, sarsıntı, güç kaybı, düzensiz rölanti; arıza lambası yanar.",
      "risk": "Yanmamış yakıt egzoz sistemine (katalizör/partikül filtresi) zarar verebilir ve tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzventil-Stromkreis Fehlfunktion",
      "part": "Der Stromkreis oder die Verkabelung der Einspritzdüsen, die den Kraftstoff in den Motor spritzen.",
      "symptoms": "Motorruckeln, Leistungsverlust, unruhiger Leerlauf; die Motorkontrollleuchte leuchtet.",
      "risk": "Unverbrannter Kraftstoff kann Katalysator bzw. Partikelfilter beschädigen und der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0201": {
    "tr": {
      "title": "Enjektör Devresi Arızası - 1. Silindir",
      "part": "1. silindire yakıt püskürten enjektör veya elektrik bağlantısı.",
      "symptoms": "Motorda tekleme ve sarsıntı, güç kaybı, düzensiz rölanti; arıza lambası yanabilir.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzventil Zylinder 1 - Stromkreisfehler",
      "part": "Die Einspritzdüse von Zylinder 1 oder ihre elektrische Verbindung.",
      "symptoms": "Motorruckeln und Zündaussetzer, Leistungsverlust, unruhiger Leerlauf; Warnleuchte möglich.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0202": {
    "tr": {
      "title": "Enjektör Devresi Arızası - 2. Silindir",
      "part": "2. silindire yakıt püskürten enjektör veya elektrik bağlantısı.",
      "symptoms": "Motorda tekleme ve sarsıntı, güç kaybı, düzensiz rölanti; arıza lambası yanabilir.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzventil Zylinder 2 - Stromkreisfehler",
      "part": "Die Einspritzdüse von Zylinder 2 oder ihre elektrische Verbindung.",
      "symptoms": "Motorruckeln und Zündaussetzer, Leistungsverlust, unruhiger Leerlauf; Warnleuchte möglich.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0203": {
    "tr": {
      "title": "Enjektör Devresi Arızası - 3. Silindir",
      "part": "3. silindire yakıt püskürten enjektör veya elektrik bağlantısı.",
      "symptoms": "Motorda tekleme ve sarsıntı, güç kaybı, düzensiz rölanti; arıza lambası yanabilir.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzventil Zylinder 3 - Stromkreisfehler",
      "part": "Die Einspritzdüse von Zylinder 3 oder ihre elektrische Verbindung.",
      "symptoms": "Motorruckeln und Zündaussetzer, Leistungsverlust, unruhiger Leerlauf; Warnleuchte möglich.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0204": {
    "tr": {
      "title": "Enjektör Devresi Arızası - 4. Silindir",
      "part": "4. silindire yakıt püskürten enjektör veya elektrik bağlantısı.",
      "symptoms": "Motorda tekleme ve sarsıntı, güç kaybı, düzensiz rölanti; arıza lambası yanabilir.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzventil Zylinder 4 - Stromkreisfehler",
      "part": "Die Einspritzdüse von Zylinder 4 oder ihre elektrische Verbindung.",
      "symptoms": "Motorruckeln und Zündaussetzer, Leistungsverlust, unruhiger Leerlauf; Warnleuchte möglich.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0205": {
    "tr": {
      "title": "Enjektör Devresi Arızası - 5. Silindir",
      "part": "5. silindire yakıt püskürten enjektör veya elektrik bağlantısı.",
      "symptoms": "Motorda tekleme ve sarsıntı, güç kaybı, düzensiz rölanti; arıza lambası yanabilir.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzventil Zylinder 5 - Stromkreisfehler",
      "part": "Die Einspritzdüse von Zylinder 5 oder ihre elektrische Verbindung.",
      "symptoms": "Motorruckeln und Zündaussetzer, Leistungsverlust, unruhiger Leerlauf; Warnleuchte möglich.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0206": {
    "tr": {
      "title": "Enjektör Devresi Arızası - 6. Silindir",
      "part": "6. silindire yakıt püskürten enjektör veya elektrik bağlantısı.",
      "symptoms": "Motorda tekleme ve sarsıntı, güç kaybı, düzensiz rölanti; arıza lambası yanabilir.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzventil Zylinder 6 - Stromkreisfehler",
      "part": "Die Einspritzdüse von Zylinder 6 oder ihre elektrische Verbindung.",
      "symptoms": "Motorruckeln und Zündaussetzer, Leistungsverlust, unruhiger Leerlauf; Warnleuchte möglich.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0207": {
    "tr": {
      "title": "Enjektör Devresi Arızası - 7. Silindir",
      "part": "7. silindire yakıt püskürten enjektör veya elektrik bağlantısı.",
      "symptoms": "Motorda tekleme ve sarsıntı, güç kaybı, düzensiz rölanti; arıza lambası yanabilir.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzventil Zylinder 7 - Stromkreisfehler",
      "part": "Die Einspritzdüse von Zylinder 7 oder ihre elektrische Verbindung.",
      "symptoms": "Motorruckeln und Zündaussetzer, Leistungsverlust, unruhiger Leerlauf; Warnleuchte möglich.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0208": {
    "tr": {
      "title": "Enjektör Devresi Arızası - 8. Silindir",
      "part": "8. silindire yakıt püskürten enjektör veya elektrik bağlantısı.",
      "symptoms": "Motorda tekleme ve sarsıntı, güç kaybı, düzensiz rölanti; arıza lambası yanabilir.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzventil Zylinder 8 - Stromkreisfehler",
      "part": "Die Einspritzdüse von Zylinder 8 oder ihre elektrische Verbindung.",
      "symptoms": "Motorruckeln und Zündaussetzer, Leistungsverlust, unruhiger Leerlauf; Warnleuchte möglich.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0217": {
    "tr": {
      "title": "Motor Aşırı Isınma Durumu",
      "part": "Motor soğutma sistemi; motor izin verilen sıcaklığın üzerine çıkmış.",
      "symptoms": "Sıcaklık göstergesi kırmızıda, uyarı lambası yanar, güç kaybı; motor bölümünden buhar gelebilir.",
      "risk": "Motorda ağır hasar (conta, blok) oluşabilir; hemen güvenli bir yerde durun, motoru kapatın ve servise haber verin."
    },
    "de": {
      "title": "Motorüberhitzung",
      "part": "Das Kühlsystem des Motors; der Motor ist zu heiß geworden.",
      "symptoms": "Temperaturanzeige im roten Bereich, Warnleuchte, Leistungsverlust; eventuell Dampf aus dem Motorraum.",
      "risk": "Es droht schwerer Motorschaden (Dichtung, Block); sofort sicher anhalten, Motor abstellen und die Werkstatt informieren."
    }
  },
  "P0218": {
    "tr": {
      "title": "Şanzıman Aşırı Isınma Durumu",
      "part": "Şanzıman (vites kutusu); şanzıman yağı aşırı ısınmış.",
      "symptoms": "Uyarı lambası, sert veya gecikmeli vites geçişleri, yanık kokusu olabilir.",
      "risk": "Şanzıman hasarı riski yüksek; durup soğumasını bekleyin ve kısa sürede servise gidin."
    },
    "de": {
      "title": "Getriebeüberhitzung",
      "part": "Das Getriebe; das Getriebeöl ist zu heiß geworden.",
      "symptoms": "Warnleuchte, harte oder verzögerte Schaltvorgänge, eventuell Brandgeruch.",
      "risk": "Hohes Risiko eines Getriebeschadens; anhalten, abkühlen lassen und zeitnah in die Werkstatt."
    }
  },
  "P0219": {
    "tr": {
      "title": "Motor Aşırı Devir Durumu",
      "part": "Motor; izin verilen en yüksek devir sayısı aşılmış.",
      "symptoms": "Genellikle yanlış vites küçültme sonrası kaydedilir; kısa süreli güç kesilmesi hissedilebilir.",
      "risk": "Aşırı devir motorda kalıcı hasara yol açabilir; tekrarlanıyorsa servise gösterin ve düşük viteste yüksek devirden kaçının."
    },
    "de": {
      "title": "Motorüberdrehzahl",
      "part": "Der Motor; die zulässige Höchstdrehzahl wurde überschritten.",
      "symptoms": "Wird meist nach falschem Herunterschalten gespeichert; kurzzeitiger Leistungsabfall möglich.",
      "risk": "Überdrehen kann den Motor dauerhaft schädigen; bei Wiederholung Werkstatt aufsuchen und hohe Drehzahlen im kleinen Gang vermeiden."
    }
  },
  "P0230": {
    "tr": {
      "title": "Yakıt Pompası Birincil Devre Arızası",
      "part": "Yakıt pompasını çalıştıran elektrik devresi veya rölesi.",
      "symptoms": "Zor çalışma, seyir halinde ani stop, motorun hiç çalışmaması.",
      "risk": "Araç yolda aniden stop edebilir veya çalışmayabilir; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Kraftstoffpumpe Primärstromkreis Fehlfunktion",
      "part": "Der Stromkreis oder das Relais, das die Kraftstoffpumpe ansteuert.",
      "symptoms": "Schwerer Start, plötzliches Absterben während der Fahrt, Motor springt eventuell nicht an.",
      "risk": "Das Fahrzeug kann unterwegs liegen bleiben oder nicht starten; zeitnah in die Werkstatt."
    }
  },
  "P0231": {
    "tr": {
      "title": "Yakıt Pompası İkincil Devre - Düşük Sinyal",
      "part": "Yakıt pompasının elektrik devresi; sinyal olması gerekenden düşük.",
      "symptoms": "Zor çalışma, güç kaybı, seyir halinde ani stop.",
      "risk": "Araç yolda kalabilir; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Kraftstoffpumpe Sekundärstromkreis - Signal zu niedrig",
      "part": "Der Stromkreis der Kraftstoffpumpe; das Signal ist niedriger als vorgesehen.",
      "symptoms": "Schwerer Start, Leistungsverlust, plötzliches Absterben während der Fahrt.",
      "risk": "Das Fahrzeug kann liegen bleiben; zeitnah in die Werkstatt."
    }
  },
  "P0232": {
    "tr": {
      "title": "Yakıt Pompası İkincil Devre - Yüksek Sinyal",
      "part": "Yakıt pompasının elektrik devresi; sinyal olması gerekenden yüksek.",
      "symptoms": "Zor çalışma, güç kaybı; pompa sürekli çalışıp akü boşalabilir.",
      "risk": "Araç yolda kalabilir veya elektrik arızası büyüyebilir; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Kraftstoffpumpe Sekundärstromkreis - Signal zu hoch",
      "part": "Der Stromkreis der Kraftstoffpumpe; das Signal ist höher als vorgesehen.",
      "symptoms": "Schwerer Start, Leistungsverlust; die Pumpe kann dauerhaft laufen und die Batterie entladen.",
      "risk": "Das Fahrzeug kann liegen bleiben oder der Elektrikfehler kann sich ausweiten; zeitnah in die Werkstatt."
    }
  },
  "P0233": {
    "tr": {
      "title": "Yakıt Pompası İkincil Devre - Kesintili Sinyal",
      "part": "Yakıt pompasının elektrik devresi; bağlantı zaman zaman kesiliyor (gevşek kablo/soket olabilir).",
      "symptoms": "Ara ara tekleme veya ani stop, bazen sorunsuz çalışma; belirtiler gelip gidebilir.",
      "risk": "Arıza öngörülemez şekilde araç yolda bırakabilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Kraftstoffpumpe Sekundärstromkreis - Signal unterbrochen",
      "part": "Der Stromkreis der Kraftstoffpumpe; die Verbindung fällt zeitweise aus (möglich lockeres Kabel oder Stecker).",
      "symptoms": "Zeitweises Ruckeln oder plötzliches Absterben, dazwischen normaler Betrieb; die Symptome kommen und gehen.",
      "risk": "Der Fehler kann das Fahrzeug unvorhersehbar liegen lassen; zeitnah in die Werkstatt."
    }
  },
  "P0234": {
    "tr": {
      "title": "Turbo Aşırı Basınç Durumu (Overboost)",
      "part": "Turbo basınç kontrol sistemi; turbo izin verilenden fazla basınç üretiyor.",
      "symptoms": "Ani güç dalgalanması, ardından belirgin güç kaybı (emniyet modu); arıza lambası yanabilir.",
      "risk": "Aşırı basınç motora ve turboya ağır hasar verebilir; gaza yüklenmeyin ve en kısa sürede servise gidin."
    },
    "de": {
      "title": "Turbolader-Überdruck (Overboost)",
      "part": "Die Ladedruckregelung; der Turbolader erzeugt mehr Druck als erlaubt.",
      "symptoms": "Plötzlicher Leistungsschub, danach deutlicher Leistungsverlust (Notlaufprogramm); Warnleuchte möglich.",
      "risk": "Zu hoher Ladedruck kann Motor und Turbo schwer beschädigen; nicht stark beschleunigen und schnellstmöglich in die Werkstatt."
    }
  },
  "P0235": {
    "tr": {
      "title": "Turbo Basınç Sensörü A - Devre Arızası",
      "part": "Turbonun ürettiği basıncı ölçen sensör veya kablosu.",
      "symptoms": "Güç kaybı, emniyet moduna geçiş, artan yakıt tüketimi.",
      "risk": "Motor gücü kısıtlı kalır ve tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Ladedrucksensor A - Stromkreisfehler",
      "part": "Der Sensor, der den Ladedruck des Turbos misst, oder seine Verkabelung.",
      "symptoms": "Leistungsverlust, Notlaufprogramm, höherer Kraftstoffverbrauch.",
      "risk": "Die Motorleistung bleibt begrenzt und der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0236": {
    "tr": {
      "title": "Turbo Basınç Sensörü A - Aralık/Performans",
      "part": "Turbo basıncını ölçen sensör; mantıksız veya tutarsız değer gönderiyor.",
      "symptoms": "Güç kaybı, emniyet modu, düzensiz hızlanma, artan tüketim.",
      "risk": "Motor gücü kısıtlı kalır; sorun turbo kontrolünü de etkileyebilir, kısa sürede servise gidin."
    },
    "de": {
      "title": "Ladedrucksensor A - Bereich/Funktion",
      "part": "Der Ladedrucksensor liefert unplausible oder schwankende Werte.",
      "symptoms": "Leistungsverlust, Notlaufprogramm, ungleichmäßige Beschleunigung, höherer Verbrauch.",
      "risk": "Die Motorleistung bleibt begrenzt und die Ladedruckregelung kann gestört sein; zeitnah in die Werkstatt."
    }
  },
  "P0237": {
    "tr": {
      "title": "Turbo Basınç Sensörü A - Düşük Sinyal",
      "part": "Turbo basıncını ölçen sensör veya kablosu; sinyal olması gerekenden düşük.",
      "symptoms": "Güç kaybı, emniyet modu, artan yakıt tüketimi.",
      "risk": "Motor gücü kısıtlı kalır ve tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Ladedrucksensor A - Signal zu niedrig",
      "part": "Der Ladedrucksensor oder seine Verkabelung; das Signal ist niedriger als vorgesehen.",
      "symptoms": "Leistungsverlust, Notlaufprogramm, höherer Kraftstoffverbrauch.",
      "risk": "Die Motorleistung bleibt begrenzt und der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0238": {
    "tr": {
      "title": "Turbo Basınç Sensörü A - Yüksek Sinyal",
      "part": "Turbo basıncını ölçen sensör veya kablosu; sinyal olması gerekenden yüksek.",
      "symptoms": "Güç kaybı, emniyet modu, artan yakıt tüketimi.",
      "risk": "Motor gücü kısıtlı kalır ve tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Ladedrucksensor A - Signal zu hoch",
      "part": "Der Ladedrucksensor oder seine Verkabelung; das Signal ist höher als vorgesehen.",
      "symptoms": "Leistungsverlust, Notlaufprogramm, höherer Kraftstoffverbrauch.",
      "risk": "Die Motorleistung bleibt begrenzt und der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0243": {
    "tr": {
      "title": "Turbo Wastegate Selenoidi A - Arıza",
      "part": "Turbo basıncını ayarlayan wastegate valfini kumanda eden elektrikli valf (selenoid) veya kablosu.",
      "symptoms": "Güç kaybı veya düzensiz güç, emniyet moduna geçiş, artan tüketim.",
      "risk": "Yanlış turbo basıncı zamanla turboya ve motora zarar verebilir; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Turbolader-Wastegate-Magnetventil A - Fehlfunktion",
      "part": "Das Magnetventil, das über das Wastegate den Ladedruck des Turbos regelt, oder seine Verkabelung.",
      "symptoms": "Leistungsverlust oder ungleichmäßige Leistung, Notlaufprogramm, höherer Verbrauch.",
      "risk": "Falscher Ladedruck kann Turbo und Motor auf Dauer schädigen; zeitnah in die Werkstatt."
    }
  },
  "P0244": {
    "tr": {
      "title": "Turbo Wastegate Selenoidi A - Aralık/Performans",
      "part": "Turbo basıncını ayarlayan wastegate selenoidi; beklenen şekilde çalışmıyor.",
      "symptoms": "Güç kaybı veya dalgalı güç, emniyet modu, artan tüketim.",
      "risk": "Yanlış turbo basıncı zamanla turboya ve motora zarar verebilir; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Turbolader-Wastegate-Magnetventil A - Bereich/Funktion",
      "part": "Das Wastegate-Magnetventil des Turbos arbeitet nicht wie vorgesehen.",
      "symptoms": "Leistungsverlust oder schwankende Leistung, Notlaufprogramm, höherer Verbrauch.",
      "risk": "Falscher Ladedruck kann Turbo und Motor auf Dauer schädigen; zeitnah in die Werkstatt."
    }
  },
  "P0245": {
    "tr": {
      "title": "Turbo Wastegate Selenoidi A - Düşük Sinyal",
      "part": "Turbo basıncını ayarlayan wastegate selenoidi veya kablosu; sinyal olması gerekenden düşük.",
      "symptoms": "Güç kaybı, emniyet moduna geçiş, artan tüketim.",
      "risk": "Yanlış turbo basıncı zamanla turboya ve motora zarar verebilir; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Turbolader-Wastegate-Magnetventil A - Signal zu niedrig",
      "part": "Das Wastegate-Magnetventil des Turbos oder seine Verkabelung; das Signal ist niedriger als vorgesehen.",
      "symptoms": "Leistungsverlust, Notlaufprogramm, höherer Verbrauch.",
      "risk": "Falscher Ladedruck kann Turbo und Motor auf Dauer schädigen; zeitnah in die Werkstatt."
    }
  },
  "P0246": {
    "tr": {
      "title": "Turbo Wastegate Selenoidi A - Yüksek Sinyal",
      "part": "Turbo basıncını ayarlayan wastegate selenoidi veya kablosu; sinyal olması gerekenden yüksek.",
      "symptoms": "Güç kaybı, emniyet moduna geçiş, artan tüketim.",
      "risk": "Yanlış turbo basıncı zamanla turboya ve motora zarar verebilir; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Turbolader-Wastegate-Magnetventil A - Signal zu hoch",
      "part": "Das Wastegate-Magnetventil des Turbos oder seine Verkabelung; das Signal ist höher als vorgesehen.",
      "symptoms": "Leistungsverlust, Notlaufprogramm, höherer Verbrauch.",
      "risk": "Falscher Ladedruck kann Turbo und Motor auf Dauer schädigen; zeitnah in die Werkstatt."
    }
  },
  "P0251": {
    "tr": {
      "title": "Enjeksiyon Pompası Yakıt Ölçüm Kontrolü A - Arıza",
      "part": "Dizel enjeksiyon pompasında motora giden yakıt miktarını ayarlayan kontrol mekanizması.",
      "symptoms": "Zor çalışma, güç kaybı, düzensiz çalışma, stop etme, egzozdan duman.",
      "risk": "Araç yolda kalabilir veya hiç çalışmayabilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzpumpe Kraftstoffzumessung A - Fehlfunktion",
      "part": "Die Regelung an der Diesel-Einspritzpumpe, die die Kraftstoffmenge für den Motor bestimmt.",
      "symptoms": "Schwerer Start, Leistungsverlust, unrunder Lauf, Absterben, Rauch aus dem Auspuff.",
      "risk": "Das Fahrzeug kann liegen bleiben oder nicht anspringen; schnellstmöglich in die Werkstatt."
    }
  },
  "P0252": {
    "tr": {
      "title": "Enjeksiyon Pompası Yakıt Ölçüm Kontrolü A - Aralık/Performans",
      "part": "Dizel enjeksiyon pompasının yakıt miktarı ayarı; beklenen şekilde çalışmıyor.",
      "symptoms": "Zor çalışma, güç kaybı, düzensiz çalışma, egzozdan duman.",
      "risk": "Sorun ilerleyip aracı yolda bırakabilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzpumpe Kraftstoffzumessung A - Bereich/Funktion",
      "part": "Die Kraftstoffmengenregelung der Diesel-Einspritzpumpe arbeitet nicht wie vorgesehen.",
      "symptoms": "Schwerer Start, Leistungsverlust, unrunder Lauf, Rauch aus dem Auspuff.",
      "risk": "Der Fehler kann sich verschlimmern und das Fahrzeug liegen lassen; schnellstmöglich in die Werkstatt."
    }
  },
  "P0253": {
    "tr": {
      "title": "Enjeksiyon Pompası Yakıt Ölçüm Kontrolü A - Düşük Sinyal",
      "part": "Dizel enjeksiyon pompasının yakıt miktarı kontrol devresi; sinyal olması gerekenden düşük.",
      "symptoms": "Zor çalışma, güç kaybı, stop etme.",
      "risk": "Araç yolda kalabilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzpumpe Kraftstoffzumessung A - Signal zu niedrig",
      "part": "Der Regelkreis der Kraftstoffzumessung an der Diesel-Einspritzpumpe; das Signal ist niedriger als vorgesehen.",
      "symptoms": "Schwerer Start, Leistungsverlust, Absterben des Motors.",
      "risk": "Das Fahrzeug kann liegen bleiben; schnellstmöglich in die Werkstatt."
    }
  },
  "P0254": {
    "tr": {
      "title": "Enjeksiyon Pompası Yakıt Ölçüm Kontrolü A - Yüksek Sinyal",
      "part": "Dizel enjeksiyon pompasının yakıt miktarı kontrol devresi; sinyal olması gerekenden yüksek.",
      "symptoms": "Düzensiz çalışma, güç kaybı, egzozdan duman, stop etme.",
      "risk": "Araç yolda kalabilir ve motor zarar görebilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzpumpe Kraftstoffzumessung A - Signal zu hoch",
      "part": "Der Regelkreis der Kraftstoffzumessung an der Diesel-Einspritzpumpe; das Signal ist höher als vorgesehen.",
      "symptoms": "Unrunder Lauf, Leistungsverlust, Rauch aus dem Auspuff, Absterben des Motors.",
      "risk": "Das Fahrzeug kann liegen bleiben und der Motor Schaden nehmen; schnellstmöglich in die Werkstatt."
    }
  },
  "P0261": {
    "tr": {
      "title": "1. Silindir Enjektör Devresi - Düşük Sinyal",
      "part": "1. silindire yakıt püskürten enjektör veya kablosu; devrede düşük sinyal ölçülüyor.",
      "symptoms": "Motorda tekleme, sarsıntı, güç kaybı, düzensiz rölanti.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Zylinder 1 Einspritzventil - Signal zu niedrig",
      "part": "Die Einspritzdüse von Zylinder 1 oder ihre Verkabelung; im Stromkreis wird ein zu niedriges Signal gemessen.",
      "symptoms": "Zündaussetzer, Ruckeln, Leistungsverlust, unruhiger Leerlauf.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0262": {
    "tr": {
      "title": "1. Silindir Enjektör Devresi - Yüksek Sinyal",
      "part": "1. silindire yakıt püskürten enjektör veya kablosu; devrede yüksek sinyal ölçülüyor.",
      "symptoms": "Motorda tekleme, sarsıntı, güç kaybı, düzensiz rölanti.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Zylinder 1 Einspritzventil - Signal zu hoch",
      "part": "Die Einspritzdüse von Zylinder 1 oder ihre Verkabelung; im Stromkreis wird ein zu hohes Signal gemessen.",
      "symptoms": "Zündaussetzer, Ruckeln, Leistungsverlust, unruhiger Leerlauf.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0264": {
    "tr": {
      "title": "2. Silindir Enjektör Devresi - Düşük Sinyal",
      "part": "2. silindire yakıt püskürten enjektör veya kablosu; devrede düşük sinyal ölçülüyor.",
      "symptoms": "Motorda tekleme, sarsıntı, güç kaybı, düzensiz rölanti.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Zylinder 2 Einspritzventil - Signal zu niedrig",
      "part": "Die Einspritzdüse von Zylinder 2 oder ihre Verkabelung; im Stromkreis wird ein zu niedriges Signal gemessen.",
      "symptoms": "Zündaussetzer, Ruckeln, Leistungsverlust, unruhiger Leerlauf.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0265": {
    "tr": {
      "title": "2. Silindir Enjektör Devresi - Yüksek Sinyal",
      "part": "2. silindire yakıt püskürten enjektör veya kablosu; devrede yüksek sinyal ölçülüyor.",
      "symptoms": "Motorda tekleme, sarsıntı, güç kaybı, düzensiz rölanti.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Zylinder 2 Einspritzventil - Signal zu hoch",
      "part": "Die Einspritzdüse von Zylinder 2 oder ihre Verkabelung; im Stromkreis wird ein zu hohes Signal gemessen.",
      "symptoms": "Zündaussetzer, Ruckeln, Leistungsverlust, unruhiger Leerlauf.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0267": {
    "tr": {
      "title": "3. Silindir Enjektör Devresi - Düşük Sinyal",
      "part": "3. silindire yakıt püskürten enjektör veya kablosu; devrede düşük sinyal ölçülüyor.",
      "symptoms": "Motorda tekleme, sarsıntı, güç kaybı, düzensiz rölanti.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Zylinder 3 Einspritzventil - Signal zu niedrig",
      "part": "Die Einspritzdüse von Zylinder 3 oder ihre Verkabelung; im Stromkreis wird ein zu niedriges Signal gemessen.",
      "symptoms": "Zündaussetzer, Ruckeln, Leistungsverlust, unruhiger Leerlauf.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0268": {
    "tr": {
      "title": "3. Silindir Enjektör Devresi - Yüksek Sinyal",
      "part": "3. silindire yakıt püskürten enjektör veya kablosu; devrede yüksek sinyal ölçülüyor.",
      "symptoms": "Motorda tekleme, sarsıntı, güç kaybı, düzensiz rölanti.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Zylinder 3 Einspritzventil - Signal zu hoch",
      "part": "Die Einspritzdüse von Zylinder 3 oder ihre Verkabelung; im Stromkreis wird ein zu hohes Signal gemessen.",
      "symptoms": "Zündaussetzer, Ruckeln, Leistungsverlust, unruhiger Leerlauf.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0270": {
    "tr": {
      "title": "4. Silindir Enjektör Devresi - Düşük Sinyal",
      "part": "4. silindire yakıt püskürten enjektör veya kablosu; devrede düşük sinyal ölçülüyor.",
      "symptoms": "Motorda tekleme, sarsıntı, güç kaybı, düzensiz rölanti.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Zylinder 4 Einspritzventil - Signal zu niedrig",
      "part": "Die Einspritzdüse von Zylinder 4 oder ihre Verkabelung; im Stromkreis wird ein zu niedriges Signal gemessen.",
      "symptoms": "Zündaussetzer, Ruckeln, Leistungsverlust, unruhiger Leerlauf.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0271": {
    "tr": {
      "title": "4. Silindir Enjektör Devresi - Yüksek Sinyal",
      "part": "4. silindire yakıt püskürten enjektör veya kablosu; devrede yüksek sinyal ölçülüyor.",
      "symptoms": "Motorda tekleme, sarsıntı, güç kaybı, düzensiz rölanti.",
      "risk": "Sürekli tekleme motoru ve egzoz sistemini yıpratır, tüketim artar; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Zylinder 4 Einspritzventil - Signal zu hoch",
      "part": "Die Einspritzdüse von Zylinder 4 oder ihre Verkabelung; im Stromkreis wird ein zu hohes Signal gemessen.",
      "symptoms": "Zündaussetzer, Ruckeln, Leistungsverlust, unruhiger Leerlauf.",
      "risk": "Dauerhafte Aussetzer schaden Motor und Abgasanlage, der Verbrauch steigt; zeitnah in die Werkstatt."
    }
  },
  "P0299": {
    "tr": {
      "title": "Turbo Düşük Basınç Arızası (Underboost)",
      "part": "Turboşarj, basınç hortumları veya turbo kontrol valfi.",
      "symptoms": "Belirgin güç kaybı, özellikle yokuşta ve yük altında çekmeme; araç güç sınırlamalı acil moda geçebilir.",
      "risk": "Kaçak veya arızalı turbo devam ederse motora kalıcı hasar verebilir; kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Turbolader – Ladedruck zu niedrig (Underboost)",
      "part": "Turbolader, Ladedruckschläuche oder das Steuerventil des Turbosystems.",
      "symptoms": "Deutlicher Leistungsverlust, vor allem bergauf und unter Last; das Fahrzeug kann ins Notlaufprogramm schalten.",
      "risk": "Ein Leck oder defekter Turbo kann den Motor dauerhaft schädigen; zeitnah in die Werkstatt."
    }
  },
  "P0300": {
    "tr": {
      "title": "Rastgele/Çoklu Silindir Ateşleme Hatası (Misfire)",
      "part": "Motorun birden fazla silindirinde yanma düzgün gerçekleşmiyor; buji, bobin, enjektör veya yakıt sistemi kaynaklı olabilir.",
      "symptoms": "Motorda titreme, sarsıntı, güç kaybı ve düzensiz rölanti. Motor arıza lambası yanıp sönebilir.",
      "risk": "Yanmamış yakıt katalizöre kalıcı hasar verebilir. Lamba yanıp sönüyorsa aracı zorlamayın, en kısa sürede servise gidin."
    },
    "de": {
      "title": "Zufällige/mehrfache Verbrennungsaussetzer erkannt",
      "part": "In mehreren Zylindern verbrennt der Kraftstoff nicht richtig; mögliche Ursachen sind Zündkerzen, Zündspulen, Einspritzdüsen oder die Kraftstoffversorgung.",
      "symptoms": "Motorruckeln, Vibrationen, Leistungsverlust und unruhiger Leerlauf. Die Motorkontrollleuchte kann blinken.",
      "risk": "Unverbrannter Kraftstoff kann den Katalysator dauerhaft beschädigen. Bei blinkender Leuchte den Motor schonen und schnellstmöglich in die Werkstatt."
    }
  },
  "P0301": {
    "tr": {
      "title": "Silindir 1 Ateşleme Hatası (Misfire)",
      "part": "Motorun 1 numaralı silindirinde yanma aksıyor; genellikle o silindirin bujisi, bobini veya enjektörü kaynaklıdır.",
      "symptoms": "Motorda tekleme, sarsıntı ve güç kaybı hissedilir; rölanti düzensizleşir.",
      "risk": "Sürekli tekleme katalizöre zarar verir ve yakıt tüketimini artırır; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Verbrennungsaussetzer Zylinder 1 erkannt",
      "part": "Im Zylinder 1 verbrennt der Kraftstoff nicht richtig; meist liegt es an Zündkerze, Zündspule oder Einspritzdüse dieses Zylinders.",
      "symptoms": "Motorruckeln, Vibrationen und Leistungsverlust; der Leerlauf wird unruhig.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator und erhöhen den Verbrauch; zeitnah in die Werkstatt."
    }
  },
  "P0302": {
    "tr": {
      "title": "Silindir 2 Ateşleme Hatası (Misfire)",
      "part": "Motorun 2 numaralı silindirinde yanma aksıyor; genellikle o silindirin bujisi, bobini veya enjektörü kaynaklıdır.",
      "symptoms": "Motorda tekleme, sarsıntı ve güç kaybı hissedilir; rölanti düzensizleşir.",
      "risk": "Sürekli tekleme katalizöre zarar verir ve yakıt tüketimini artırır; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Verbrennungsaussetzer Zylinder 2 erkannt",
      "part": "Im Zylinder 2 verbrennt der Kraftstoff nicht richtig; meist liegt es an Zündkerze, Zündspule oder Einspritzdüse dieses Zylinders.",
      "symptoms": "Motorruckeln, Vibrationen und Leistungsverlust; der Leerlauf wird unruhig.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator und erhöhen den Verbrauch; zeitnah in die Werkstatt."
    }
  },
  "P0303": {
    "tr": {
      "title": "Silindir 3 Ateşleme Hatası (Misfire)",
      "part": "Motorun 3 numaralı silindirinde yanma aksıyor; genellikle o silindirin bujisi, bobini veya enjektörü kaynaklıdır.",
      "symptoms": "Motorda tekleme, sarsıntı ve güç kaybı hissedilir; rölanti düzensizleşir.",
      "risk": "Sürekli tekleme katalizöre zarar verir ve yakıt tüketimini artırır; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Verbrennungsaussetzer Zylinder 3 erkannt",
      "part": "Im Zylinder 3 verbrennt der Kraftstoff nicht richtig; meist liegt es an Zündkerze, Zündspule oder Einspritzdüse dieses Zylinders.",
      "symptoms": "Motorruckeln, Vibrationen und Leistungsverlust; der Leerlauf wird unruhig.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator und erhöhen den Verbrauch; zeitnah in die Werkstatt."
    }
  },
  "P0304": {
    "tr": {
      "title": "Silindir 4 Ateşleme Hatası (Misfire)",
      "part": "Motorun 4 numaralı silindirinde yanma aksıyor; genellikle o silindirin bujisi, bobini veya enjektörü kaynaklıdır.",
      "symptoms": "Motorda tekleme, sarsıntı ve güç kaybı hissedilir; rölanti düzensizleşir.",
      "risk": "Sürekli tekleme katalizöre zarar verir ve yakıt tüketimini artırır; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Verbrennungsaussetzer Zylinder 4 erkannt",
      "part": "Im Zylinder 4 verbrennt der Kraftstoff nicht richtig; meist liegt es an Zündkerze, Zündspule oder Einspritzdüse dieses Zylinders.",
      "symptoms": "Motorruckeln, Vibrationen und Leistungsverlust; der Leerlauf wird unruhig.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator und erhöhen den Verbrauch; zeitnah in die Werkstatt."
    }
  },
  "P0305": {
    "tr": {
      "title": "Silindir 5 Ateşleme Hatası (Misfire)",
      "part": "Motorun 5 numaralı silindirinde yanma aksıyor; genellikle o silindirin bujisi, bobini veya enjektörü kaynaklıdır.",
      "symptoms": "Motorda tekleme, sarsıntı ve güç kaybı hissedilir; rölanti düzensizleşir.",
      "risk": "Sürekli tekleme katalizöre zarar verir ve yakıt tüketimini artırır; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Verbrennungsaussetzer Zylinder 5 erkannt",
      "part": "Im Zylinder 5 verbrennt der Kraftstoff nicht richtig; meist liegt es an Zündkerze, Zündspule oder Einspritzdüse dieses Zylinders.",
      "symptoms": "Motorruckeln, Vibrationen und Leistungsverlust; der Leerlauf wird unruhig.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator und erhöhen den Verbrauch; zeitnah in die Werkstatt."
    }
  },
  "P0306": {
    "tr": {
      "title": "Silindir 6 Ateşleme Hatası (Misfire)",
      "part": "Motorun 6 numaralı silindirinde yanma aksıyor; genellikle o silindirin bujisi, bobini veya enjektörü kaynaklıdır.",
      "symptoms": "Motorda tekleme, sarsıntı ve güç kaybı hissedilir; rölanti düzensizleşir.",
      "risk": "Sürekli tekleme katalizöre zarar verir ve yakıt tüketimini artırır; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Verbrennungsaussetzer Zylinder 6 erkannt",
      "part": "Im Zylinder 6 verbrennt der Kraftstoff nicht richtig; meist liegt es an Zündkerze, Zündspule oder Einspritzdüse dieses Zylinders.",
      "symptoms": "Motorruckeln, Vibrationen und Leistungsverlust; der Leerlauf wird unruhig.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator und erhöhen den Verbrauch; zeitnah in die Werkstatt."
    }
  },
  "P0307": {
    "tr": {
      "title": "Silindir 7 Ateşleme Hatası (Misfire)",
      "part": "Motorun 7 numaralı silindirinde yanma aksıyor; genellikle o silindirin bujisi, bobini veya enjektörü kaynaklıdır.",
      "symptoms": "Motorda tekleme, sarsıntı ve güç kaybı hissedilir; rölanti düzensizleşir.",
      "risk": "Sürekli tekleme katalizöre zarar verir ve yakıt tüketimini artırır; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Verbrennungsaussetzer Zylinder 7 erkannt",
      "part": "Im Zylinder 7 verbrennt der Kraftstoff nicht richtig; meist liegt es an Zündkerze, Zündspule oder Einspritzdüse dieses Zylinders.",
      "symptoms": "Motorruckeln, Vibrationen und Leistungsverlust; der Leerlauf wird unruhig.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator und erhöhen den Verbrauch; zeitnah in die Werkstatt."
    }
  },
  "P0308": {
    "tr": {
      "title": "Silindir 8 Ateşleme Hatası (Misfire)",
      "part": "Motorun 8 numaralı silindirinde yanma aksıyor; genellikle o silindirin bujisi, bobini veya enjektörü kaynaklıdır.",
      "symptoms": "Motorda tekleme, sarsıntı ve güç kaybı hissedilir; rölanti düzensizleşir.",
      "risk": "Sürekli tekleme katalizöre zarar verir ve yakıt tüketimini artırır; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Verbrennungsaussetzer Zylinder 8 erkannt",
      "part": "Im Zylinder 8 verbrennt der Kraftstoff nicht richtig; meist liegt es an Zündkerze, Zündspule oder Einspritzdüse dieses Zylinders.",
      "symptoms": "Motorruckeln, Vibrationen und Leistungsverlust; der Leerlauf wird unruhig.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator und erhöhen den Verbrauch; zeitnah in die Werkstatt."
    }
  },
  "P0313": {
    "tr": {
      "title": "Düşük Yakıt Seviyesinde Ateşleme Hatası (Misfire)",
      "part": "Depoda yakıt çok azken silindirlerde yanma aksaması tespit edildi; motor yakıtı düzenli çekemiyor olabilir.",
      "symptoms": "Yakıt göstergesi düşükken tekleme, sarsıntı ve güç kaybı yaşanır.",
      "risk": "Önce depoyu doldurun; hata dolu depoyla da devam ederse yakıt sistemi servise gösterilmeli. Uzun süre teklemeyle sürüş katalizöre zarar verir."
    },
    "de": {
      "title": "Verbrennungsaussetzer bei niedrigem Kraftstoffstand",
      "part": "Bei fast leerem Tank wurden Verbrennungsaussetzer festgestellt; der Motor bekommt möglicherweise nicht gleichmäßig Kraftstoff.",
      "symptoms": "Ruckeln, Vibrationen und Leistungsverlust, wenn die Tankanzeige niedrig steht.",
      "risk": "Zuerst volltanken; bleibt der Fehler bestehen, das Kraftstoffsystem prüfen lassen. Längeres Fahren mit Aussetzern schadet dem Katalysator."
    }
  },
  "P0316": {
    "tr": {
      "title": "İlk Çalıştırmada Ateşleme Hatası (İlk 1000 Devir)",
      "part": "Motor çalıştırıldıktan hemen sonra silindirlerde yanma aksıyor; buji, enjektör veya yakıt basıncı kaynaklı olabilir.",
      "symptoms": "Motor özellikle soğukken zor çalışır, ilk saniyelerde sarsılır veya tekler.",
      "risk": "Sorun büyüyerek sürekli teklemeye dönüşebilir ve katalizöre zarar verebilir; uygun zamanda servise gösterin."
    },
    "de": {
      "title": "Verbrennungsaussetzer beim Start (erste 1000 Umdrehungen)",
      "part": "Direkt nach dem Motorstart treten Verbrennungsaussetzer auf; mögliche Ursachen sind Zündkerzen, Einspritzdüsen oder der Kraftstoffdruck.",
      "symptoms": "Der Motor springt vor allem kalt schlecht an, ruckelt oder stottert in den ersten Sekunden.",
      "risk": "Das Problem kann sich zu dauerhaften Aussetzern entwickeln und den Katalysator schädigen; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0320": {
    "tr": {
      "title": "Ateşleme/Distribütör Motor Devir Sinyali Devre Arızası",
      "part": "Motor devrini motor beynine bildiren sinyal devresi veya sensör kablosu arızalı.",
      "symptoms": "Motor tekleyebilir, aniden stop edebilir veya hiç çalışmayabilir; devir göstergesi hatalı çalışabilir.",
      "risk": "Araç seyir halinde beklenmedik şekilde stop edip yolda kalabilir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Motordrehzahlsignal (Zündung/Verteiler) Stromkreis fehlerhaft",
      "part": "Der Stromkreis oder die Verkabelung des Signals, das die Motordrehzahl an das Steuergerät meldet, ist defekt.",
      "symptoms": "Der Motor kann ruckeln, plötzlich ausgehen oder gar nicht anspringen; der Drehzahlmesser kann falsch anzeigen.",
      "risk": "Das Fahrzeug kann während der Fahrt unerwartet ausgehen und liegen bleiben; schnellstmöglich in die Werkstatt."
    }
  },
  "P0321": {
    "tr": {
      "title": "Ateşleme/Distribütör Devir Sinyali Aralık/Performans Hatası",
      "part": "Motor devrini bildiren sinyal geliyor ancak değerleri beklenen aralığın dışında; sensör veya kablo bağlantısı sorunlu olabilir.",
      "symptoms": "Düzensiz rölanti, tekleme, ara sıra stop etme; devir göstergesi oynayabilir.",
      "risk": "Arıza ilerleyip aracı yolda bırakabilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Motordrehzahlsignal (Zündung/Verteiler) Bereich/Funktion",
      "part": "Das Drehzahlsignal kommt an, liegt aber außerhalb des erwarteten Bereichs; Sensor oder Kabelverbindung können fehlerhaft sein.",
      "symptoms": "Unruhiger Leerlauf, Ruckeln, gelegentliches Absterben des Motors; der Drehzahlmesser kann schwanken.",
      "risk": "Der Fehler kann sich verschlimmern und zum Liegenbleiben führen; zeitnah in die Werkstatt."
    }
  },
  "P0322": {
    "tr": {
      "title": "Ateşleme/Distribütör Devir Sinyali Yok",
      "part": "Motor devrini bildiren sensörden hiç sinyal gelmiyor; sensör, kablo veya soket kopmuş ya da arızalı olabilir.",
      "symptoms": "Motor çalışmayabilir veya seyir halinde aniden stop edebilir; devir göstergesi sıfırda kalabilir.",
      "risk": "Araç her an yolda kalabilir; aracı kullanmaya devam etmeyin, hemen servisle iletişime geçin."
    },
    "de": {
      "title": "Motordrehzahlsignal (Zündung/Verteiler) kein Signal",
      "part": "Vom Drehzahlsensor kommt gar kein Signal; Sensor, Kabel oder Stecker können unterbrochen oder defekt sein.",
      "symptoms": "Der Motor springt eventuell nicht an oder geht während der Fahrt plötzlich aus; der Drehzahlmesser kann auf null bleiben.",
      "risk": "Das Fahrzeug kann jederzeit liegen bleiben; nicht weiterfahren und sofort die Werkstatt kontaktieren."
    }
  },
  "P0325": {
    "tr": {
      "title": "Vuruntu Sensörü 1 Devre Arızası (Sıra 1)",
      "part": "Motordaki anormal yanmayı (vuruntuyu) algılayan sensör veya kablosu arızalı.",
      "symptoms": "Çoğu zaman belirgin bir his olmaz; hafif güç kaybı, artan yakıt tüketimi veya hızlanırken metalik tıkırtı olabilir.",
      "risk": "Motor vuruntuya karşı korumasız kalır ve uzun vadede içten hasar görebilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Klopfsensor 1 Stromkreisfehler (Bank 1)",
      "part": "Der Sensor, der abnormale Verbrennung (Klopfen) im Motor erkennt, oder seine Verkabelung ist defekt.",
      "symptoms": "Meist kaum spürbar; leichter Leistungsverlust, höherer Verbrauch oder metallisches Klingeln beim Beschleunigen sind möglich.",
      "risk": "Der Motor ist nicht mehr gegen Klopfen geschützt und kann langfristig innere Schäden erleiden; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0326": {
    "tr": {
      "title": "Vuruntu Sensörü 1 Aralık/Performans Hatası (Sıra 1)",
      "part": "Vuruntu sensörü sinyal veriyor ancak değerleri beklenen aralığın dışında; sensör veya bağlantısı sorunlu olabilir.",
      "symptoms": "Genellikle sadece motor lambası yanar; hafif güç kaybı veya artan yakıt tüketimi olabilir.",
      "risk": "Motor vuruntu korumasını kaybedebilir; acil değil ama uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Klopfsensor 1 Bereich/Funktion (Bank 1)",
      "part": "Der Klopfsensor liefert ein Signal, aber außerhalb des erwarteten Bereichs; Sensor oder Anschluss können fehlerhaft sein.",
      "symptoms": "Meist leuchtet nur die Motorkontrollleuchte; leichter Leistungsverlust oder höherer Verbrauch sind möglich.",
      "risk": "Der Klopfschutz des Motors kann ausfallen; nicht akut, aber bei Gelegenheit in die Werkstatt."
    }
  },
  "P0327": {
    "tr": {
      "title": "Vuruntu Sensörü 1 Düşük Sinyal (Sıra 1)",
      "part": "Vuruntu sensöründen gelen sinyal çok zayıf; sensör, kablosu veya soketi arızalı olabilir.",
      "symptoms": "Genellikle sadece motor lambası yanar; hafif güç kaybı veya artan yakıt tüketimi fark edilebilir.",
      "risk": "Motor vuruntuya karşı korumasız kalır; uzun vadede motor hasarı riski var, uygun zamanda servise gidin."
    },
    "de": {
      "title": "Klopfsensor 1 Signal zu niedrig (Bank 1)",
      "part": "Das Signal des Klopfsensors ist zu schwach; Sensor, Kabel oder Stecker können defekt sein.",
      "symptoms": "Meist leuchtet nur die Motorkontrollleuchte; leichter Leistungsverlust oder höherer Verbrauch sind möglich.",
      "risk": "Der Motor ist nicht mehr gegen Klopfen geschützt; langfristig droht Motorschaden, bei Gelegenheit in die Werkstatt."
    }
  },
  "P0328": {
    "tr": {
      "title": "Vuruntu Sensörü 1 Yüksek Sinyal (Sıra 1)",
      "part": "Vuruntu sensöründen gelen sinyal beklenenden çok yüksek; sensör, kablosu veya gerçek bir mekanik gürültü kaynaklı olabilir.",
      "symptoms": "Genellikle sadece motor lambası yanar; güç düşebilir ve yakıt tüketimi artabilir.",
      "risk": "Motor beyni güvenli moda geçip performansı kısabilir; uygun zamanda servise gösterilmeli."
    },
    "de": {
      "title": "Klopfsensor 1 Signal zu hoch (Bank 1)",
      "part": "Das Signal des Klopfsensors ist deutlich zu hoch; Ursache kann der Sensor, das Kabel oder ein echtes mechanisches Geräusch sein.",
      "symptoms": "Meist leuchtet nur die Motorkontrollleuchte; Leistung kann sinken und der Verbrauch steigen.",
      "risk": "Das Steuergerät kann in ein Schutzprogramm schalten und die Leistung drosseln; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0330": {
    "tr": {
      "title": "Vuruntu Sensörü 2 Devre Arızası (Sıra 2)",
      "part": "Motorun ikinci tarafındaki (Sıra 2) vuruntu sensörü veya kablosu arızalı.",
      "symptoms": "Çoğu zaman belirgin bir his olmaz; hafif güç kaybı, artan yakıt tüketimi veya hızlanırken metalik tıkırtı olabilir.",
      "risk": "Motor vuruntuya karşı korumasız kalır ve uzun vadede içten hasar görebilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Klopfsensor 2 Stromkreisfehler (Bank 2)",
      "part": "Der Klopfsensor auf der zweiten Motorseite (Bank 2) oder seine Verkabelung ist defekt.",
      "symptoms": "Meist kaum spürbar; leichter Leistungsverlust, höherer Verbrauch oder metallisches Klingeln beim Beschleunigen sind möglich.",
      "risk": "Der Motor ist nicht mehr gegen Klopfen geschützt und kann langfristig innere Schäden erleiden; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0335": {
    "tr": {
      "title": "Krank Mili Konum Sensörü A Devre Arızası",
      "part": "Motorun devrini ve pistonların konumunu ölçen krank sensörü veya kablosu arızalı.",
      "symptoms": "Motor zor çalışır, seyir halinde aniden stop edebilir, tekleyebilir; devir göstergesi oynayabilir.",
      "risk": "Araç her an yolda kalabilir veya hiç çalışmayabilir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Kurbelwellen-Positionssensor A Stromkreisfehler",
      "part": "Der Sensor, der Motordrehzahl und Kolbenstellung misst, oder seine Verkabelung ist defekt.",
      "symptoms": "Der Motor springt schlecht an, kann während der Fahrt plötzlich ausgehen oder ruckeln; der Drehzahlmesser kann schwanken.",
      "risk": "Das Fahrzeug kann jederzeit liegen bleiben oder gar nicht mehr anspringen; schnellstmöglich in die Werkstatt."
    }
  },
  "P0336": {
    "tr": {
      "title": "Krank Mili Konum Sensörü A Aralık/Performans Hatası",
      "part": "Krank sensörü sinyal veriyor ancak değerleri beklenen aralığın dışında; sensör, kablo veya sinyal çarkı sorunlu olabilir.",
      "symptoms": "Düzensiz çalışma, tekleme, ara sıra zor çalıştırma veya stop etme.",
      "risk": "Arıza ilerleyip aracı yolda bırakabilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Kurbelwellen-Positionssensor A Bereich/Funktion",
      "part": "Der Kurbelwellensensor liefert ein Signal, aber außerhalb des erwarteten Bereichs; Sensor, Kabel oder Geberrad können fehlerhaft sein.",
      "symptoms": "Unrunder Motorlauf, Ruckeln, gelegentlich schlechtes Anspringen oder Absterben.",
      "risk": "Der Fehler kann sich verschlimmern und zum Liegenbleiben führen; zeitnah in die Werkstatt."
    }
  },
  "P0337": {
    "tr": {
      "title": "Krank Mili Konum Sensörü A Düşük Sinyal",
      "part": "Krank sensöründen gelen sinyal çok zayıf; sensör, kablosu veya soketi arızalı olabilir.",
      "symptoms": "Zor çalıştırma, tekleme, seyir halinde ani stop etme.",
      "risk": "Araç yolda kalabilir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Kurbelwellen-Positionssensor A Signal zu niedrig",
      "part": "Das Signal des Kurbelwellensensors ist zu schwach; Sensor, Kabel oder Stecker können defekt sein.",
      "symptoms": "Schlechtes Anspringen, Ruckeln, plötzliches Ausgehen während der Fahrt.",
      "risk": "Das Fahrzeug kann liegen bleiben; schnellstmöglich in die Werkstatt."
    }
  },
  "P0338": {
    "tr": {
      "title": "Krank Mili Konum Sensörü A Yüksek Sinyal",
      "part": "Krank sensöründen gelen sinyal beklenenden çok yüksek; sensör veya kablo tesisatında arıza olabilir.",
      "symptoms": "Zor çalıştırma, tekleme, seyir halinde ani stop etme.",
      "risk": "Araç yolda kalabilir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Kurbelwellen-Positionssensor A Signal zu hoch",
      "part": "Das Signal des Kurbelwellensensors ist deutlich zu hoch; Sensor oder Verkabelung können defekt sein.",
      "symptoms": "Schlechtes Anspringen, Ruckeln, plötzliches Ausgehen während der Fahrt.",
      "risk": "Das Fahrzeug kann liegen bleiben; schnellstmöglich in die Werkstatt."
    }
  },
  "P0339": {
    "tr": {
      "title": "Krank Mili Konum Sensörü A Kesintili Sinyal",
      "part": "Krank sensörünün sinyali zaman zaman kesiliyor; genellikle gevşek soket, hasarlı kablo veya arızalı sensör kaynaklıdır.",
      "symptoms": "Ara sıra tekleme, ani stop etme ve tekrar çalışma; sorun düzensiz aralıklarla ortaya çıkar.",
      "risk": "Kesintiler sıklaşıp aracı yolda bırakabilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Kurbelwellen-Positionssensor A Signal sporadisch unterbrochen",
      "part": "Das Signal des Kurbelwellensensors fällt zeitweise aus; meist wegen lockerem Stecker, beschädigtem Kabel oder defektem Sensor.",
      "symptoms": "Gelegentliches Ruckeln, plötzliches Ausgehen und Wiederanspringen; das Problem tritt unregelmäßig auf.",
      "risk": "Die Aussetzer können häufiger werden und zum Liegenbleiben führen; zeitnah in die Werkstatt."
    }
  },
  "P0340": {
    "tr": {
      "title": "Eksantrik Mili Konum Sensörü A Devre Arızası (Sıra 1)",
      "part": "Supapları çalıştıran eksantrik milinin konumunu izleyen sensör veya kablosu arızalı.",
      "symptoms": "Zor çalıştırma, güç kaybı, düzensiz rölanti ve artan yakıt tüketimi; motor stop edebilir.",
      "risk": "Motor çalışmayabilir veya seyirde stop edebilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Nockenwellen-Positionssensor A Stromkreisfehler (Bank 1)",
      "part": "Der Sensor, der die Stellung der Nockenwelle überwacht, oder seine Verkabelung ist defekt.",
      "symptoms": "Schlechtes Anspringen, Leistungsverlust, unruhiger Leerlauf und höherer Verbrauch; der Motor kann ausgehen.",
      "risk": "Der Motor kann nicht mehr anspringen oder während der Fahrt ausgehen; zeitnah in die Werkstatt."
    }
  },
  "P0341": {
    "tr": {
      "title": "Eksantrik Mili Konum Sensörü A Aralık/Performans (Sıra 1)",
      "part": "Eksantrik sensörü sinyal veriyor ancak değerleri beklenen aralığın dışında; sensör, kablo veya triger ayarı sorunlu olabilir.",
      "symptoms": "Zor çalıştırma, düzensiz rölanti, güç kaybı ve tekleme olabilir.",
      "risk": "Arıza ilerleyebilir ve motor stop edebilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Nockenwellen-Positionssensor A Bereich/Funktion (Bank 1)",
      "part": "Der Nockenwellensensor liefert ein Signal, aber außerhalb des erwarteten Bereichs; Sensor, Kabel oder die Steuerzeiten können fehlerhaft sein.",
      "symptoms": "Schlechtes Anspringen, unruhiger Leerlauf, Leistungsverlust und Ruckeln sind möglich.",
      "risk": "Der Fehler kann sich verschlimmern und der Motor ausgehen; zeitnah in die Werkstatt."
    }
  },
  "P0342": {
    "tr": {
      "title": "Eksantrik Mili Konum Sensörü A Düşük Sinyal (Sıra 1)",
      "part": "Eksantrik sensöründen gelen sinyal çok zayıf; sensör, kablosu veya soketi arızalı olabilir.",
      "symptoms": "Zor çalıştırma, düzensiz rölanti, güç kaybı; motor stop edebilir.",
      "risk": "Motor çalışmayabilir veya yolda stop edebilir; kısa sürede servise gidin."
    },
    "de": {
      "title": "Nockenwellen-Positionssensor A Signal zu niedrig (Bank 1)",
      "part": "Das Signal des Nockenwellensensors ist zu schwach; Sensor, Kabel oder Stecker können defekt sein.",
      "symptoms": "Schlechtes Anspringen, unruhiger Leerlauf, Leistungsverlust; der Motor kann ausgehen.",
      "risk": "Der Motor kann nicht anspringen oder unterwegs ausgehen; zeitnah in die Werkstatt."
    }
  },
  "P0343": {
    "tr": {
      "title": "Eksantrik Mili Konum Sensörü A Yüksek Sinyal (Sıra 1)",
      "part": "Eksantrik sensöründen gelen sinyal beklenenden çok yüksek; sensör veya kablo tesisatında arıza olabilir.",
      "symptoms": "Zor çalıştırma, düzensiz rölanti, güç kaybı; motor stop edebilir.",
      "risk": "Motor çalışmayabilir veya yolda stop edebilir; kısa sürede servise gidin."
    },
    "de": {
      "title": "Nockenwellen-Positionssensor A Signal zu hoch (Bank 1)",
      "part": "Das Signal des Nockenwellensensors ist deutlich zu hoch; Sensor oder Verkabelung können defekt sein.",
      "symptoms": "Schlechtes Anspringen, unruhiger Leerlauf, Leistungsverlust; der Motor kann ausgehen.",
      "risk": "Der Motor kann nicht anspringen oder unterwegs ausgehen; zeitnah in die Werkstatt."
    }
  },
  "P0344": {
    "tr": {
      "title": "Eksantrik Mili Konum Sensörü A Kesintili Sinyal (Sıra 1)",
      "part": "Eksantrik sensörünün sinyali zaman zaman kesiliyor; gevşek soket, hasarlı kablo veya arızalı sensör kaynaklı olabilir.",
      "symptoms": "Ara sıra tekleme, ani stop etme, zor çalıştırma; sorun düzensiz aralıklarla ortaya çıkar.",
      "risk": "Kesintiler sıklaşıp aracı yolda bırakabilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Nockenwellen-Positionssensor A Signal sporadisch (Bank 1)",
      "part": "Das Signal des Nockenwellensensors fällt zeitweise aus; mögliche Ursachen sind lockerer Stecker, beschädigtes Kabel oder defekter Sensor.",
      "symptoms": "Gelegentliches Ruckeln, plötzliches Ausgehen, schlechtes Anspringen; das Problem tritt unregelmäßig auf.",
      "risk": "Die Aussetzer können häufiger werden und zum Liegenbleiben führen; zeitnah in die Werkstatt."
    }
  },
  "P0345": {
    "tr": {
      "title": "Eksantrik Mili Konum Sensörü A Devre Arızası (Sıra 2)",
      "part": "Motorun ikinci tarafındaki (Sıra 2) eksantrik mili konum sensörü veya kablosu arızalı.",
      "symptoms": "Zor çalıştırma, güç kaybı, düzensiz rölanti ve artan yakıt tüketimi; motor stop edebilir.",
      "risk": "Motor çalışmayabilir veya seyirde stop edebilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Nockenwellen-Positionssensor A Stromkreisfehler (Bank 2)",
      "part": "Der Nockenwellen-Positionssensor auf der zweiten Motorseite (Bank 2) oder seine Verkabelung ist defekt.",
      "symptoms": "Schlechtes Anspringen, Leistungsverlust, unruhiger Leerlauf und höherer Verbrauch; der Motor kann ausgehen.",
      "risk": "Der Motor kann nicht mehr anspringen oder während der Fahrt ausgehen; zeitnah in die Werkstatt."
    }
  },
  "P0350": {
    "tr": {
      "title": "Ateşleme Bobini Primer/Sekonder Devre Arızası",
      "part": "Benzinli motorlarda bujilere kıvılcım için yüksek voltaj üreten ateşleme bobini veya kablosu arızalı.",
      "symptoms": "Tekleme, sarsıntı, güç kaybı ve zor çalıştırma; motor lambası yanıp sönebilir.",
      "risk": "Yanmamış yakıt katalizöre zarar verir; kısa sürede servise gösterilmeli, lamba yanıp sönüyorsa aracı zorlamayın."
    },
    "de": {
      "title": "Zündspule Primär-/Sekundärkreis Fehlfunktion",
      "part": "Die Zündspule, die bei Benzinmotoren die Hochspannung für den Zündfunken erzeugt, oder ihre Verkabelung ist defekt.",
      "symptoms": "Ruckeln, Vibrationen, Leistungsverlust und schlechtes Anspringen; die Motorkontrollleuchte kann blinken.",
      "risk": "Unverbrannter Kraftstoff schadet dem Katalysator; zeitnah in die Werkstatt, bei blinkender Leuchte den Motor schonen."
    }
  },
  "P0351": {
    "tr": {
      "title": "Ateşleme Bobini A Devre Arızası (Silindir 1)",
      "part": "1 numaralı silindirin bujisine kıvılcım sağlayan ateşleme bobini veya kablosu arızalı.",
      "symptoms": "Tek silindirde tekleme, sarsıntı, güç kaybı; motor lambası yanıp sönebilir.",
      "risk": "Sürekli tekleme katalizöre zarar verir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Zündspule A (Zylinder 1) Primär-/Sekundärkreis Fehler",
      "part": "Die Zündspule, die den Zündfunken für Zylinder 1 liefert, oder ihre Verkabelung ist defekt.",
      "symptoms": "Ruckeln durch Aussetzer eines Zylinders, Vibrationen, Leistungsverlust; die Motorkontrollleuchte kann blinken.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator; zeitnah in die Werkstatt."
    }
  },
  "P0352": {
    "tr": {
      "title": "Ateşleme Bobini B Devre Arızası (Silindir 2)",
      "part": "2 numaralı silindirin bujisine kıvılcım sağlayan ateşleme bobini veya kablosu arızalı.",
      "symptoms": "Tek silindirde tekleme, sarsıntı, güç kaybı; motor lambası yanıp sönebilir.",
      "risk": "Sürekli tekleme katalizöre zarar verir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Zündspule B (Zylinder 2) Primär-/Sekundärkreis Fehler",
      "part": "Die Zündspule, die den Zündfunken für Zylinder 2 liefert, oder ihre Verkabelung ist defekt.",
      "symptoms": "Ruckeln durch Aussetzer eines Zylinders, Vibrationen, Leistungsverlust; die Motorkontrollleuchte kann blinken.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator; zeitnah in die Werkstatt."
    }
  },
  "P0353": {
    "tr": {
      "title": "Ateşleme Bobini C Devre Arızası (Silindir 3)",
      "part": "3 numaralı silindirin bujisine kıvılcım sağlayan ateşleme bobini veya kablosu arızalı.",
      "symptoms": "Tek silindirde tekleme, sarsıntı, güç kaybı; motor lambası yanıp sönebilir.",
      "risk": "Sürekli tekleme katalizöre zarar verir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Zündspule C (Zylinder 3) Primär-/Sekundärkreis Fehler",
      "part": "Die Zündspule, die den Zündfunken für Zylinder 3 liefert, oder ihre Verkabelung ist defekt.",
      "symptoms": "Ruckeln durch Aussetzer eines Zylinders, Vibrationen, Leistungsverlust; die Motorkontrollleuchte kann blinken.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator; zeitnah in die Werkstatt."
    }
  },
  "P0354": {
    "tr": {
      "title": "Ateşleme Bobini D Devre Arızası (Silindir 4)",
      "part": "4 numaralı silindirin bujisine kıvılcım sağlayan ateşleme bobini veya kablosu arızalı.",
      "symptoms": "Tek silindirde tekleme, sarsıntı, güç kaybı; motor lambası yanıp sönebilir.",
      "risk": "Sürekli tekleme katalizöre zarar verir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Zündspule D (Zylinder 4) Primär-/Sekundärkreis Fehler",
      "part": "Die Zündspule, die den Zündfunken für Zylinder 4 liefert, oder ihre Verkabelung ist defekt.",
      "symptoms": "Ruckeln durch Aussetzer eines Zylinders, Vibrationen, Leistungsverlust; die Motorkontrollleuchte kann blinken.",
      "risk": "Anhaltende Aussetzer schädigen den Katalysator; zeitnah in die Werkstatt."
    }
  },
  "P0380": {
    "tr": {
      "title": "Kızdırma Bujisi/Isıtıcı Devresi A Arızası",
      "part": "Dizel motorun soğukken kolay çalışmasını sağlayan kızdırma bujileri veya bunların kablo tesisatı.",
      "symptoms": "Soğuk havada zor çalışma, ilk çalıştırmada beyaz duman, kısa süreli düzensiz rölanti.",
      "risk": "Soğuk havalarda araç hiç çalışmayabilir; özellikle kış aylarından önce servise gösterilmeli."
    },
    "de": {
      "title": "Glühkerzen-/Heizkreis A – Fehlfunktion",
      "part": "Die Glühkerzen, die dem Dieselmotor beim Kaltstart helfen, oder deren Verkabelung.",
      "symptoms": "Schlechter Kaltstart, weißer Rauch beim Anlassen, kurzzeitig unruhiger Leerlauf.",
      "risk": "Bei Kälte springt das Fahrzeug eventuell gar nicht an; besonders vor dem Winter in die Werkstatt bringen."
    }
  },
  "P0381": {
    "tr": {
      "title": "Kızdırma Bujisi Gösterge Lambası Devre Arızası",
      "part": "Gösterge panelindeki kızdırma bujisi (spiral) ikaz lambasının elektrik devresi.",
      "symptoms": "Kızdırma lambası hiç yanmayabilir veya sürekli yanık kalabilir; motor genelde normal çalışır.",
      "risk": "Sürüşü doğrudan etkilemez ama gerçek bir kızdırma arızasını fark etmenizi engelleyebilir; bir sonraki serviste kontrol ettirin."
    },
    "de": {
      "title": "Glühkerzen-Kontrollleuchte – Stromkreisfehler",
      "part": "Der Stromkreis der Glühwendel-Kontrollleuchte im Armaturenbrett.",
      "symptoms": "Die Vorglühlampe leuchtet gar nicht oder dauerhaft; der Motor läuft meist normal.",
      "risk": "Beeinträchtigt die Fahrt nicht direkt, kann aber echte Glühkerzenprobleme verdecken; beim nächsten Service prüfen lassen."
    }
  },
  "P0382": {
    "tr": {
      "title": "Kızdırma Bujisi/Isıtıcı Devresi B Arızası",
      "part": "Kızdırma bujilerinin ikinci grubu (B devresi) veya bunların kablo tesisatı.",
      "symptoms": "Soğukta zor çalışma, çalıştırma sırasında beyaz duman, ilk dakikalarda titrek çalışma.",
      "risk": "Soğuk havalarda çalıştırma sorunu büyür ve araç yolda kalabilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Glühkerzen-/Heizkreis B – Fehlfunktion",
      "part": "Die zweite Gruppe der Glühkerzen (Kreis B) oder deren Verkabelung.",
      "symptoms": "Schwerer Kaltstart, weißer Rauch beim Starten, unrunder Motorlauf in den ersten Minuten.",
      "risk": "Bei Kälte verschärft sich das Startproblem und das Fahrzeug kann liegen bleiben; zeitnah zur Werkstatt."
    }
  },
  "P0383": {
    "tr": {
      "title": "Kızdırma Bujisi Kontrol Modülü Devresi Düşük Sinyal",
      "part": "Kızdırma bujilerini yöneten kontrol ünitesi (röle/modül) ve kabloları.",
      "symptoms": "Soğukta zor veya geç çalışma, kızdırma lambasında anormallik, arıza lambası.",
      "risk": "Kızdırma sistemi tamamen devre dışı kalabilir ve soğukta araç çalışmayabilir; kısa sürede servise gidin."
    },
    "de": {
      "title": "Glühkerzen-Steuergerät – Signal zu niedrig",
      "part": "Das Steuergerät (Relais/Modul), das die Glühkerzen ansteuert, und dessen Verkabelung.",
      "symptoms": "Schwerer oder verzögerter Kaltstart, auffällige Vorglühlampe, Motorkontrollleuchte.",
      "risk": "Das Vorglühsystem kann komplett ausfallen und das Fahrzeug springt bei Kälte nicht an; zeitnah zur Werkstatt."
    }
  },
  "P0400": {
    "tr": {
      "title": "EGR (Egzoz Gazı Devridaimi) Akış Arızası",
      "part": "Egzoz gazının bir kısmını emisyonu azaltmak için motora geri gönderen EGR valfi ve sistemi.",
      "symptoms": "Düzensiz rölanti, çekiş zayıflığı, ara sıra teklemeler, arıza lambası.",
      "risk": "Emisyon artar ve motorda kurum birikerek daha pahalı arızalara yol açabilir; acil değil ama yakın zamanda servise gösterilmeli."
    },
    "de": {
      "title": "AGR-System (Abgasrückführung) – Durchflussfehler",
      "part": "Das AGR-Ventil und System, das zur Abgasreduzierung einen Teil der Abgase zum Motor zurückführt.",
      "symptoms": "Unruhiger Leerlauf, schwächerer Durchzug, gelegentliches Ruckeln, Motorkontrollleuchte.",
      "risk": "Höhere Emissionen und Rußablagerungen im Motor können teurere Schäden verursachen; kein Notfall, aber bald in die Werkstatt."
    }
  },
  "P0401": {
    "tr": {
      "title": "EGR Akışı Yetersiz",
      "part": "EGR valfi yeterince açılmıyor; genellikle valf veya kanalları kurumla tıkanmıştır.",
      "symptoms": "Hızlanırken vuruntu sesi, hafif güç kaybı, arıza lambası; bazen hiçbir şey hissedilmez.",
      "risk": "Motor vuruntusu uzun vadede motora zarar verebilir ve egzoz muayenesinden kalınabilir; makul sürede servise gidin."
    },
    "de": {
      "title": "AGR-Durchfluss zu gering",
      "part": "Das AGR-Ventil öffnet zu wenig; meist sind Ventil oder Kanäle verrußt.",
      "symptoms": "Klingelndes Geräusch beim Beschleunigen, leichter Leistungsverlust, Motorkontrollleuchte; manchmal spürt man nichts.",
      "risk": "Motorklopfen kann den Motor auf Dauer schädigen und die Abgasuntersuchung wird nicht bestanden; in absehbarer Zeit zur Werkstatt."
    }
  },
  "P0402": {
    "tr": {
      "title": "EGR Akışı Aşırı",
      "part": "EGR valfi gereğinden fazla açık kalıyor veya açık pozisyonda takılı.",
      "symptoms": "Düzensiz rölanti, duraksama, motorun stop etmesi, zayıf hızlanma.",
      "risk": "Motor trafikte aniden stop edebilir; güvenlik açısından kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "AGR-Durchfluss zu hoch",
      "part": "Das AGR-Ventil bleibt zu weit oder dauerhaft offen.",
      "symptoms": "Unruhiger Leerlauf, Zögern beim Gasgeben, Absterben des Motors, schwache Beschleunigung.",
      "risk": "Der Motor kann im Verkehr plötzlich ausgehen; aus Sicherheitsgründen zeitnah zur Werkstatt."
    }
  },
  "P0403": {
    "tr": {
      "title": "EGR Kontrol Devresi Arızası",
      "part": "EGR valfini çalıştıran elektrik devresi, soketi veya kabloları.",
      "symptoms": "Arıza lambası; çoğu zaman belirgin bir sürüş farkı olmaz, bazen düzensiz rölanti.",
      "risk": "EGR sistemi devre dışı kalır, emisyon artar ve muayeneden kalınabilir; yakın zamanda servise gösterin."
    },
    "de": {
      "title": "AGR-Steuerkreis – Fehlfunktion",
      "part": "Der elektrische Stromkreis, Stecker oder die Kabel des AGR-Ventils.",
      "symptoms": "Motorkontrollleuchte; oft kein spürbarer Unterschied beim Fahren, manchmal unruhiger Leerlauf.",
      "risk": "Das AGR-System fällt aus, die Emissionen steigen und die Abgasuntersuchung kann scheitern; bald in die Werkstatt."
    }
  },
  "P0404": {
    "tr": {
      "title": "EGR Kontrol Devresi Aralık/Performans Sorunu",
      "part": "EGR valfi komutlara beklenen şekilde tepki vermiyor; valf sıkışmış veya aşınmış olabilir.",
      "symptoms": "Düzensiz rölanti, duraksama, güç kaybı, arıza lambası.",
      "risk": "Sorun ilerlerse motor stop edebilir veya kurum birikimi artar; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "AGR-Steuerkreis – Bereichs-/Funktionsfehler",
      "part": "Das AGR-Ventil reagiert nicht wie erwartet; es kann klemmen oder verschlissen sein.",
      "symptoms": "Unruhiger Leerlauf, Zögern, Leistungsverlust, Motorkontrollleuchte.",
      "risk": "Bei Verschlimmerung kann der Motor absterben oder stärker verrußen; zeitnah in die Werkstatt."
    }
  },
  "P0405": {
    "tr": {
      "title": "EGR Sensörü A Devresi Düşük Sinyal",
      "part": "EGR valfinin ne kadar açık olduğunu ölçen konum sensörü veya kablosu.",
      "symptoms": "Arıza lambası; bazen düzensiz rölanti veya hafif performans düşüşü.",
      "risk": "Motor beyni EGR'yi doğru yönetemez, yakıt tüketimi ve emisyon artabilir; yakın zamanda servise gösterin."
    },
    "de": {
      "title": "AGR-Sensor A – Signal zu niedrig",
      "part": "Der Positionssensor, der die Öffnung des AGR-Ventils misst, oder dessen Kabel.",
      "symptoms": "Motorkontrollleuchte; manchmal unruhiger Leerlauf oder leicht spürbarer Leistungsverlust.",
      "risk": "Das Steuergerät kann die AGR nicht richtig regeln, Verbrauch und Emissionen können steigen; bald in die Werkstatt."
    }
  },
  "P0406": {
    "tr": {
      "title": "EGR Sensörü A Devresi Yüksek Sinyal",
      "part": "EGR valf konum sensörü veya kablosu; sinyal olması gerekenden yüksek.",
      "symptoms": "Arıza lambası; düzensiz rölanti, duraksama veya hafif güç kaybı olabilir.",
      "risk": "EGR yanlış çalışır, emisyon artar ve muayeneden kalınabilir; yakın zamanda servise gösterin."
    },
    "de": {
      "title": "AGR-Sensor A – Signal zu hoch",
      "part": "Der Positionssensor des AGR-Ventils oder dessen Kabel; das Signal ist höher als vorgesehen.",
      "symptoms": "Motorkontrollleuchte; unruhiger Leerlauf, Zögern oder leichter Leistungsverlust möglich.",
      "risk": "Die AGR arbeitet falsch, Emissionen steigen und die Abgasuntersuchung kann scheitern; bald in die Werkstatt."
    }
  },
  "P0407": {
    "tr": {
      "title": "EGR Sensörü B Devresi Düşük Sinyal",
      "part": "EGR sistemindeki ikinci sensör (B) veya kablosu; sinyal olması gerekenden düşük.",
      "symptoms": "Arıza lambası; genellikle sürüşte belirgin bir fark hissedilmez.",
      "risk": "Emisyon kontrolü bozulur ve muayeneden kalınabilir; acil değil ama yakın zamanda servise gösterin."
    },
    "de": {
      "title": "AGR-Sensor B – Signal zu niedrig",
      "part": "Der zweite Sensor (B) im AGR-System oder dessen Kabel; das Signal ist zu niedrig.",
      "symptoms": "Motorkontrollleuchte; beim Fahren meist kein spürbarer Unterschied.",
      "risk": "Die Abgasregelung funktioniert nicht richtig und die Abgasuntersuchung kann scheitern; kein Notfall, aber bald prüfen lassen."
    }
  },
  "P0408": {
    "tr": {
      "title": "EGR Sensörü B Devresi Yüksek Sinyal",
      "part": "EGR sistemindeki ikinci sensör (B) veya kablosu; sinyal olması gerekenden yüksek.",
      "symptoms": "Arıza lambası; genellikle sürüşte belirgin bir fark hissedilmez.",
      "risk": "Emisyon kontrolü bozulur ve muayeneden kalınabilir; acil değil ama yakın zamanda servise gösterin."
    },
    "de": {
      "title": "AGR-Sensor B – Signal zu hoch",
      "part": "Der zweite Sensor (B) im AGR-System oder dessen Kabel; das Signal ist zu hoch.",
      "symptoms": "Motorkontrollleuchte; beim Fahren meist kein spürbarer Unterschied.",
      "risk": "Die Abgasregelung funktioniert nicht richtig und die Abgasuntersuchung kann scheitern; kein Notfall, aber bald prüfen lassen."
    }
  },
  "P0409": {
    "tr": {
      "title": "EGR Sensörü A Devre Arızası",
      "part": "EGR valfinin konumunu ölçen sensör (A) veya elektrik bağlantısı.",
      "symptoms": "Arıza lambası; bazen düzensiz rölanti veya hafif çekiş zayıflığı.",
      "risk": "EGR doğru yönetilemez, kurum birikimi ve emisyon artar; yakın zamanda servise gösterin."
    },
    "de": {
      "title": "AGR-Sensor A – Stromkreisfehler",
      "part": "Der Sensor (A), der die Position des AGR-Ventils misst, oder dessen elektrischer Anschluss.",
      "symptoms": "Motorkontrollleuchte; manchmal unruhiger Leerlauf oder leicht schwächerer Durchzug.",
      "risk": "Die AGR kann nicht richtig geregelt werden, Verrußung und Emissionen nehmen zu; bald in die Werkstatt."
    }
  },
  "P0410": {
    "tr": {
      "title": "İkincil Hava Enjeksiyon Sistemi Arızası",
      "part": "Soğuk çalıştırmada egzoza temiz hava basarak emisyonu azaltan hava pompası ve valfleri.",
      "symptoms": "Soğuk çalıştırmada anormal pompa sesi veya sesin hiç gelmemesi, arıza lambası; sürüş genelde normaldir.",
      "risk": "Sürüşü pek etkilemez ama egzoz muayenesinden kalınır; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Sekundärluftsystem – Fehlfunktion",
      "part": "Die Luftpumpe und Ventile, die beim Kaltstart Frischluft in den Auspuff blasen, um Emissionen zu senken.",
      "symptoms": "Ungewöhnliches Pumpengeräusch beim Kaltstart oder gar keins, Motorkontrollleuchte; das Fahren ist meist normal.",
      "risk": "Beeinträchtigt die Fahrt kaum, aber die Abgasuntersuchung wird nicht bestanden; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0411": {
    "tr": {
      "title": "İkincil Hava Sisteminde Hatalı Akış",
      "part": "İkincil hava pompasının bastığı hava egzoza doğru miktarda ulaşmıyor; hortum, valf veya pompa sorunlu olabilir.",
      "symptoms": "Soğuk çalıştırmada farklı sesler, arıza lambası; sürüşte genelde fark hissedilmez.",
      "risk": "Emisyon artar ve muayeneden kalınır; acil değil, planlı bir servis ziyaretinde giderilmeli."
    },
    "de": {
      "title": "Sekundärluftsystem – falscher Durchfluss erkannt",
      "part": "Die von der Sekundärluftpumpe geförderte Luft erreicht den Auspuff nicht in richtiger Menge; Schlauch, Ventil oder Pumpe können defekt sein.",
      "symptoms": "Ungewohnte Geräusche beim Kaltstart, Motorkontrollleuchte; beim Fahren meist kein Unterschied.",
      "risk": "Emissionen steigen und die Abgasuntersuchung wird nicht bestanden; kein Notfall, beim nächsten Werkstattbesuch beheben lassen."
    }
  },
  "P0412": {
    "tr": {
      "title": "İkincil Hava Anahtarlama Valfi A Devre Arızası",
      "part": "İkincil hava sisteminin havayı yönlendiren valfinin (A) elektrik devresi.",
      "symptoms": "Arıza lambası; sürüşte genellikle belirgin bir fark olmaz.",
      "risk": "Emisyon sistemi düzgün çalışmaz ve muayeneden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Sekundärluft-Umschaltventil A – Stromkreisfehler",
      "part": "Der elektrische Stromkreis des Ventils (A), das die Sekundärluft lenkt.",
      "symptoms": "Motorkontrollleuchte; beim Fahren meist kein spürbarer Unterschied.",
      "risk": "Das Abgassystem arbeitet nicht richtig und die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0413": {
    "tr": {
      "title": "İkincil Hava Anahtarlama Valfi A Devresi Açık",
      "part": "İkincil hava valfinin (A) elektrik devresinde kopukluk (açık devre) var.",
      "symptoms": "Arıza lambası; sürüşte genellikle fark hissedilmez.",
      "risk": "Emisyon artar ve muayeneden kalınabilir; acil değil, planlı serviste giderilmeli."
    },
    "de": {
      "title": "Sekundärluft-Umschaltventil A – Stromkreis unterbrochen",
      "part": "Im Stromkreis des Sekundärluftventils (A) liegt eine Unterbrechung vor.",
      "symptoms": "Motorkontrollleuchte; beim Fahren meist kein spürbarer Unterschied.",
      "risk": "Emissionen steigen und die Abgasuntersuchung kann scheitern; kein Notfall, beim nächsten Service beheben lassen."
    }
  },
  "P0414": {
    "tr": {
      "title": "İkincil Hava Anahtarlama Valfi A Devresinde Kısa Devre",
      "part": "İkincil hava valfinin (A) elektrik devresinde kısa devre var.",
      "symptoms": "Arıza lambası; nadiren sigorta atması, sürüşte genellikle fark olmaz.",
      "risk": "Kısa devre başka elektrik arızalarını tetikleyebilir; yakın zamanda servise gösterin."
    },
    "de": {
      "title": "Sekundärluft-Umschaltventil A – Kurzschluss",
      "part": "Im Stromkreis des Sekundärluftventils (A) liegt ein Kurzschluss vor.",
      "symptoms": "Motorkontrollleuchte; selten eine durchgebrannte Sicherung, beim Fahren meist kein Unterschied.",
      "risk": "Ein Kurzschluss kann weitere Elektrikprobleme auslösen; bald in die Werkstatt bringen."
    }
  },
  "P0418": {
    "tr": {
      "title": "İkincil Hava Sistemi Rölesi A Devre Arızası",
      "part": "İkincil hava pompasını çalıştıran rölenin (A) elektrik devresi.",
      "symptoms": "Arıza lambası; pompa soğuk çalıştırmada duyulmayabilir, sürüş genelde normaldir.",
      "risk": "Emisyon sistemi devre dışı kalır ve muayeneden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Sekundärluftsystem Relais A – Stromkreisfehler",
      "part": "Der Stromkreis des Relais (A), das die Sekundärluftpumpe einschaltet.",
      "symptoms": "Motorkontrollleuchte; die Pumpe ist beim Kaltstart eventuell nicht zu hören, das Fahren ist meist normal.",
      "risk": "Das Abgassystem fällt aus und die Abgasuntersuchung kann scheitern; bei Gelegenheit in die Werkstatt."
    }
  },
  "P0420": {
    "tr": {
      "title": "Katalizör Verimi Eşik Değerin Altında (Sıra 1)",
      "part": "Egzozdaki zararlı gazları temizleyen katalitik konvertör (Sıra 1 tarafı) veya onu izleyen oksijen sensörleri.",
      "symptoms": "Çoğu zaman sadece arıza lambası yanar; bazen hafif güç kaybı veya yakıt tüketiminde artış.",
      "risk": "Muayeneden kalınır ve katalizör tamamen bozulursa değişimi çok pahalıdır; makul sürede servise gösterin."
    },
    "de": {
      "title": "Katalysator-Wirkungsgrad unter Schwellenwert (Bank 1)",
      "part": "Der Katalysator (Seite Bank 1), der Schadstoffe im Abgas reinigt, oder die ihn überwachenden Lambdasonden.",
      "symptoms": "Meist leuchtet nur die Motorkontrollleuchte; manchmal leichter Leistungsverlust oder höherer Verbrauch.",
      "risk": "Die Abgasuntersuchung wird nicht bestanden und ein völlig defekter Katalysator ist sehr teuer; in absehbarer Zeit zur Werkstatt."
    }
  },
  "P0421": {
    "tr": {
      "title": "Isınma Katalizörü Verimi Düşük (Sıra 1)",
      "part": "Motora yakın konumdaki, soğukken devreye giren ön katalizör (Sıra 1).",
      "symptoms": "Genellikle sadece arıza lambası; sürüşte belirgin bir fark olmayabilir.",
      "risk": "Emisyon artar, muayeneden kalınır ve sorun ana katalizöre yayılabilir; makul sürede servise gösterin."
    },
    "de": {
      "title": "Warmlaufkatalysator: Wirkungsgrad zu niedrig (Bank 1)",
      "part": "Der motornahe Vorkatalysator (Bank 1), der schon in der Kaltlaufphase arbeitet.",
      "symptoms": "Meist nur die Motorkontrollleuchte; beim Fahren oft kein spürbarer Unterschied.",
      "risk": "Emissionen steigen, die Abgasuntersuchung scheitert und der Schaden kann auf den Hauptkatalysator übergreifen; in absehbarer Zeit zur Werkstatt."
    }
  },
  "P0422": {
    "tr": {
      "title": "Ana Katalizör Verimi Düşük (Sıra 1)",
      "part": "Egzoz hattındaki ana katalitik konvertör (Sıra 1).",
      "symptoms": "Genellikle sadece arıza lambası; bazen hafif güç kaybı veya yakıt artışı.",
      "risk": "Muayeneden kalınır; katalizör tıkanırsa ciddi güç kaybı ve pahalı onarım olur, makul sürede servise gösterin."
    },
    "de": {
      "title": "Hauptkatalysator: Wirkungsgrad zu niedrig (Bank 1)",
      "part": "Der Hauptkatalysator in der Abgasanlage (Bank 1).",
      "symptoms": "Meist nur die Motorkontrollleuchte; manchmal leichter Leistungsverlust oder Mehrverbrauch.",
      "risk": "Die Abgasuntersuchung wird nicht bestanden; ein verstopfter Katalysator führt zu starkem Leistungsverlust und teurer Reparatur, in absehbarer Zeit zur Werkstatt."
    }
  },
  "P0430": {
    "tr": {
      "title": "Katalizör Verimi Eşik Değerin Altında (Sıra 2)",
      "part": "Katalitik konvertörün motorun diğer tarafına (Sıra 2) ait bölümü veya onu izleyen oksijen sensörleri.",
      "symptoms": "Çoğu zaman sadece arıza lambası; bazen hafif güç kaybı veya yakıt tüketiminde artış.",
      "risk": "Muayeneden kalınır ve katalizör tamamen bozulursa değişimi çok pahalıdır; makul sürede servise gösterin."
    },
    "de": {
      "title": "Katalysator-Wirkungsgrad unter Schwellenwert (Bank 2)",
      "part": "Der Katalysator auf der anderen Motorseite (Bank 2) oder die ihn überwachenden Lambdasonden.",
      "symptoms": "Meist leuchtet nur die Motorkontrollleuchte; manchmal leichter Leistungsverlust oder höherer Verbrauch.",
      "risk": "Die Abgasuntersuchung wird nicht bestanden und ein völlig defekter Katalysator ist sehr teuer; in absehbarer Zeit zur Werkstatt."
    }
  },
  "P0431": {
    "tr": {
      "title": "Isınma Katalizörü Verimi Düşük (Sıra 2)",
      "part": "Motora yakın konumdaki, soğukken devreye giren ön katalizör (Sıra 2).",
      "symptoms": "Genellikle sadece arıza lambası; sürüşte belirgin bir fark olmayabilir.",
      "risk": "Emisyon artar, muayeneden kalınır ve sorun ana katalizöre yayılabilir; makul sürede servise gösterin."
    },
    "de": {
      "title": "Warmlaufkatalysator: Wirkungsgrad zu niedrig (Bank 2)",
      "part": "Der motornahe Vorkatalysator (Bank 2), der schon in der Kaltlaufphase arbeitet.",
      "symptoms": "Meist nur die Motorkontrollleuchte; beim Fahren oft kein spürbarer Unterschied.",
      "risk": "Emissionen steigen, die Abgasuntersuchung scheitert und der Schaden kann auf den Hauptkatalysator übergreifen; in absehbarer Zeit zur Werkstatt."
    }
  },
  "P0432": {
    "tr": {
      "title": "Ana Katalizör Verimi Düşük (Sıra 2)",
      "part": "Egzoz hattındaki ana katalitik konvertör (Sıra 2).",
      "symptoms": "Genellikle sadece arıza lambası; bazen hafif güç kaybı veya yakıt artışı.",
      "risk": "Muayeneden kalınır; katalizör tıkanırsa ciddi güç kaybı ve pahalı onarım olur, makul sürede servise gösterin."
    },
    "de": {
      "title": "Hauptkatalysator: Wirkungsgrad zu niedrig (Bank 2)",
      "part": "Der Hauptkatalysator in der Abgasanlage (Bank 2).",
      "symptoms": "Meist nur die Motorkontrollleuchte; manchmal leichter Leistungsverlust oder Mehrverbrauch.",
      "risk": "Die Abgasuntersuchung wird nicht bestanden; ein verstopfter Katalysator führt zu starkem Leistungsverlust und teurer Reparatur, in absehbarer Zeit zur Werkstatt."
    }
  },
  "P0440": {
    "tr": {
      "title": "Yakıt Buharı (EVAP) Sistemi Arızası",
      "part": "Yakıt deposundan çıkan buharları tutan sistem: depo kapağı, karbon filtre, valfler ve hortumlar.",
      "symptoms": "Çoğu zaman hissedilir bir belirti olmaz; motor arıza lambası yanar, bazen hafif yakıt kokusu olabilir.",
      "risk": "Sürüşü hemen etkilemez ancak egzoz muayenesinden kalınabilir ve yakıt kokusu artabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Tankentlüftungssystem (EVAP) Fehlfunktion",
      "part": "Das System, das Kraftstoffdämpfe aus dem Tank auffängt: Tankdeckel, Aktivkohlebehälter, Ventile und Schläuche.",
      "symptoms": "Meist keine spürbaren Symptome; die Motorkontrollleuchte leuchtet, gelegentlich leichter Kraftstoffgeruch.",
      "risk": "Keine akute Gefahr beim Fahren, aber die Abgasuntersuchung kann scheitern und es kann nach Kraftstoff riechen; zeitnah in der Werkstatt prüfen lassen."
    }
  },
  "P0441": {
    "tr": {
      "title": "EVAP Sistemi Hatalı Tahliye Akışı",
      "part": "Depoda biriken yakıt buharını motora gönderen tahliye (purge) valfi veya hortumları.",
      "symptoms": "Genelde sadece arıza lambası yanar; bazen düzensiz rölanti veya hafif çekiş dalgalanması olabilir.",
      "risk": "Acil değildir ancak yakıt tüketimi hafif artabilir ve egzoz muayenesinden kalınabilir; birkaç hafta içinde servise gösterin."
    },
    "de": {
      "title": "EVAP-System: falscher Durchfluss der Spülung",
      "part": "Das Spülventil oder die Schläuche, die gesammelte Kraftstoffdämpfe zum Motor leiten.",
      "symptoms": "Meist leuchtet nur die Motorkontrollleuchte; gelegentlich unruhiger Leerlauf oder leichtes Ruckeln.",
      "risk": "Nicht dringend, aber der Verbrauch kann leicht steigen und die Abgasuntersuchung kann scheitern; innerhalb weniger Wochen prüfen lassen."
    }
  },
  "P0442": {
    "tr": {
      "title": "EVAP Sistemi Kaçak Tespit Edildi (Küçük Kaçak)",
      "part": "Yakıt buharı sisteminde küçük bir sızıntı; en sık neden gevşek ya da yıpranmış depo kapağı veya çatlak bir hortumdur.",
      "symptoms": "Genellikle hiçbir şey hissedilmez; sadece arıza lambası yanar, nadiren hafif yakıt kokusu olur.",
      "risk": "Önce depo kapağını sıkıca kapatmayı deneyin; lamba sönmezse egzoz muayenesinden kalmamak için servise gösterin, acil değildir."
    },
    "de": {
      "title": "EVAP-System: kleines Leck erkannt",
      "part": "Ein kleines Leck im Tankentlüftungssystem; häufigste Ursache ist ein loser oder verschlissener Tankdeckel oder ein rissiger Schlauch.",
      "symptoms": "Meist ist nichts zu spüren; nur die Motorkontrollleuchte leuchtet, selten leichter Kraftstoffgeruch.",
      "risk": "Zuerst den Tankdeckel fest verschließen; geht die Lampe nicht aus, in der Werkstatt prüfen lassen, sonst droht das Nichtbestehen der Abgasuntersuchung. Nicht dringend."
    }
  },
  "P0443": {
    "tr": {
      "title": "EVAP Tahliye Valfi Devre Arızası",
      "part": "Yakıt buharını motora gönderen tahliye (purge) valfinin elektrik devresi veya kablosu.",
      "symptoms": "Arıza lambası yanar; bazen düzensiz rölanti veya soğuk çalıştırmada zorlanma görülebilir.",
      "risk": "Sürüş güvenliğini hemen etkilemez ancak yakıt tüketimi artabilir ve muayeneden kalınabilir; uygun zamanda servise gösterin."
    },
    "de": {
      "title": "EVAP-Spülventil: Fehler im Stromkreis",
      "part": "Der elektrische Stromkreis oder die Verkabelung des Spülventils, das Kraftstoffdämpfe zum Motor leitet.",
      "symptoms": "Die Motorkontrollleuchte leuchtet; gelegentlich unruhiger Leerlauf oder schlechteres Anspringen bei Kälte.",
      "risk": "Keine akute Gefahr, aber der Verbrauch kann steigen und die Abgasuntersuchung scheitern; bei Gelegenheit in der Werkstatt prüfen lassen."
    }
  },
  "P0444": {
    "tr": {
      "title": "EVAP Tahliye Valfi Devresi Açık (Kopukluk)",
      "part": "Tahliye (purge) valfine giden elektrik hattında kopukluk veya bağlantı sorunu.",
      "symptoms": "Genellikle sadece arıza lambası yanar; sürüşte belirgin bir fark hissedilmeyebilir.",
      "risk": "Acil değildir ancak buhar sistemi çalışmadığı için muayeneden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "EVAP-Spülventil: Stromkreis unterbrochen",
      "part": "Eine Unterbrechung oder ein Kontaktproblem in der elektrischen Leitung zum Spülventil.",
      "symptoms": "Meist leuchtet nur die Motorkontrollleuchte; beim Fahren ist oft kein Unterschied spürbar.",
      "risk": "Nicht dringend, aber da die Tankentlüftung nicht arbeitet, kann die Abgasuntersuchung scheitern; bei Gelegenheit prüfen lassen."
    }
  },
  "P0445": {
    "tr": {
      "title": "EVAP Tahliye Valfi Devresinde Kısa Devre",
      "part": "Tahliye (purge) valfinin elektrik devresinde kısa devre; valf veya kablo hasarlı olabilir.",
      "symptoms": "Arıza lambası yanar; bazen düzensiz rölanti veya hafif çekiş sorunları olabilir.",
      "risk": "Acil değildir ancak kısa devre başka elektrik sorunlarına yol açabilir; yakın zamanda servise gösterin."
    },
    "de": {
      "title": "EVAP-Spülventil: Kurzschluss im Stromkreis",
      "part": "Ein Kurzschluss im Stromkreis des Spülventils; das Ventil oder die Verkabelung kann beschädigt sein.",
      "symptoms": "Die Motorkontrollleuchte leuchtet; gelegentlich unruhiger Leerlauf oder leichte Leistungsprobleme.",
      "risk": "Nicht akut, aber ein Kurzschluss kann weitere Elektrikprobleme verursachen; zeitnah in der Werkstatt prüfen lassen."
    }
  },
  "P0446": {
    "tr": {
      "title": "EVAP Havalandırma Kontrol Devresi Arızası",
      "part": "Yakıt buharı sisteminin havalandırma valfi ve kontrol devresi; genellikle karbon filtrenin yanındadır.",
      "symptoms": "Genellikle belirti yoktur, sadece arıza lambası yanar; nadiren depoyu doldururken pompa erken kesebilir.",
      "risk": "Sürüşü etkilemez ancak muayeneden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "EVAP-Entlüftungssteuerung: Fehler im Stromkreis",
      "part": "Das Entlüftungsventil der Tankentlüftung und sein Steuerstromkreis, meist am Aktivkohlebehälter.",
      "symptoms": "Meist keine Symptome, nur die Motorkontrollleuchte; selten schaltet die Zapfpistole beim Tanken früh ab.",
      "risk": "Beeinträchtigt das Fahren nicht, aber die Abgasuntersuchung kann scheitern; bei Gelegenheit prüfen lassen."
    }
  },
  "P0447": {
    "tr": {
      "title": "EVAP Havalandırma Kontrol Devresi Açık (Kopukluk)",
      "part": "Havalandırma valfine giden elektrik hattında kopukluk veya bağlantı sorunu.",
      "symptoms": "Genellikle sadece arıza lambası yanar; sürüşte fark hissedilmez.",
      "risk": "Acil değildir; muayeneden kalmamak için uygun zamanda servise gösterin."
    },
    "de": {
      "title": "EVAP-Entlüftung: Stromkreis unterbrochen",
      "part": "Eine Unterbrechung oder ein Kontaktproblem in der elektrischen Leitung zum Entlüftungsventil.",
      "symptoms": "Meist leuchtet nur die Motorkontrollleuchte; beim Fahren ist nichts zu spüren.",
      "risk": "Nicht dringend; bei Gelegenheit prüfen lassen, damit die Abgasuntersuchung nicht scheitert."
    }
  },
  "P0448": {
    "tr": {
      "title": "EVAP Havalandırma Devresinde Kısa Devre",
      "part": "Havalandırma valfinin elektrik devresinde kısa devre; valf veya kablo hasarlı olabilir.",
      "symptoms": "Genellikle sadece arıza lambası yanar; nadiren depoyu doldururken zorluk yaşanabilir.",
      "risk": "Acil değildir ancak kısa devre büyüyebilir; yakın zamanda servise gösterin."
    },
    "de": {
      "title": "EVAP-Entlüftung: Kurzschluss im Stromkreis",
      "part": "Ein Kurzschluss im Stromkreis des Entlüftungsventils; Ventil oder Verkabelung kann beschädigt sein.",
      "symptoms": "Meist leuchtet nur die Motorkontrollleuchte; selten Probleme beim Betanken.",
      "risk": "Nicht akut, aber ein Kurzschluss kann sich ausweiten; zeitnah in der Werkstatt prüfen lassen."
    }
  },
  "P0449": {
    "tr": {
      "title": "EVAP Havalandırma Valfi/Selenoidi Devre Arızası",
      "part": "Yakıt buharı sisteminin havalandırma valfi (selenoid) veya elektrik bağlantısı.",
      "symptoms": "Genellikle belirti yoktur, sadece arıza lambası yanar; nadiren yakıt kokusu veya depo doldurma zorluğu olabilir.",
      "risk": "Sürüşü etkilemez ancak muayeneden kalınabilir; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "EVAP-Entlüftungsventil/Magnetventil: Stromkreisfehler",
      "part": "Das Entlüftungs-Magnetventil der Tankentlüftung oder seine elektrische Verbindung.",
      "symptoms": "Meist keine Symptome, nur die Motorkontrollleuchte; selten Kraftstoffgeruch oder Probleme beim Betanken.",
      "risk": "Beeinträchtigt das Fahren nicht, aber die Abgasuntersuchung kann scheitern; bei Gelegenheit prüfen lassen."
    }
  },
  "P0450": {
    "tr": {
      "title": "EVAP Basınç Sensörü Arızası",
      "part": "Yakıt deposundaki basıncı ölçen sensör veya kablosu.",
      "symptoms": "Sürüşte genellikle fark edilmez; sadece motor arıza lambası yanar.",
      "risk": "Acil değildir ancak sistem kaçak kontrolü yapamaz ve muayeneden kalınabilir; uygun zamanda servise gösterin."
    },
    "de": {
      "title": "EVAP-Drucksensor: Fehlfunktion",
      "part": "Der Sensor, der den Druck im Kraftstofftank misst, oder seine Verkabelung.",
      "symptoms": "Beim Fahren meist nicht spürbar; nur die Motorkontrollleuchte leuchtet.",
      "risk": "Nicht dringend, aber das System kann keine Leckprüfung mehr durchführen und die Abgasuntersuchung kann scheitern; bei Gelegenheit prüfen lassen."
    }
  },
  "P0451": {
    "tr": {
      "title": "EVAP Basınç Sensörü Aralık/Performans Hatası",
      "part": "Depo basıncını ölçen sensör mantıksız veya tutarsız değerler gönderiyor.",
      "symptoms": "Sürüşte belirti yoktur; sadece arıza lambası yanar.",
      "risk": "Acil değildir; muayeneden kalmamak ve doğru kaçak kontrolü için uygun zamanda servise gösterin."
    },
    "de": {
      "title": "EVAP-Drucksensor: Bereichs-/Leistungsfehler",
      "part": "Der Tankdrucksensor liefert unplausible oder schwankende Werte.",
      "symptoms": "Beim Fahren keine Symptome; nur die Motorkontrollleuchte leuchtet.",
      "risk": "Nicht dringend; bei Gelegenheit prüfen lassen, damit Leckprüfung und Abgasuntersuchung wieder funktionieren."
    }
  },
  "P0452": {
    "tr": {
      "title": "EVAP Basınç Sensörü Düşük Sinyal",
      "part": "Depo basınç sensörünün sinyali çok düşük; sensör veya kablo arızalı olabilir.",
      "symptoms": "Sürüşte fark edilmez; sadece arıza lambası yanar.",
      "risk": "Acil değildir; uygun bir zamanda servise gösterin, aksi halde muayeneden kalınabilir."
    },
    "de": {
      "title": "EVAP-Drucksensor: Signal zu niedrig",
      "part": "Das Signal des Tankdrucksensors ist zu niedrig; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Beim Fahren nicht spürbar; nur die Motorkontrollleuchte leuchtet.",
      "risk": "Nicht dringend; bei Gelegenheit in der Werkstatt prüfen lassen, sonst kann die Abgasuntersuchung scheitern."
    }
  },
  "P0453": {
    "tr": {
      "title": "EVAP Basınç Sensörü Yüksek Sinyal",
      "part": "Depo basınç sensörünün sinyali çok yüksek; sensör veya kablo arızalı olabilir.",
      "symptoms": "Sürüşte fark edilmez; sadece arıza lambası yanar.",
      "risk": "Acil değildir; uygun bir zamanda servise gösterin, aksi halde muayeneden kalınabilir."
    },
    "de": {
      "title": "EVAP-Drucksensor: Signal zu hoch",
      "part": "Das Signal des Tankdrucksensors ist zu hoch; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Beim Fahren nicht spürbar; nur die Motorkontrollleuchte leuchtet.",
      "risk": "Nicht dringend; bei Gelegenheit in der Werkstatt prüfen lassen, sonst kann die Abgasuntersuchung scheitern."
    }
  },
  "P0455": {
    "tr": {
      "title": "EVAP Sistemi Kaçak Tespit Edildi (Büyük Kaçak)",
      "part": "Yakıt buharı sisteminde büyük bir sızıntı; en sık neden takılmamış veya bozuk depo kapağı ya da çıkmış bir hortumdur.",
      "symptoms": "Arıza lambası yanar; araç çevresinde yakıt kokusu hissedilebilir.",
      "risk": "Önce depo kapağını kontrol edip sıkıca kapatın; koku sürüyorsa veya lamba sönmezse kısa sürede servise gösterin."
    },
    "de": {
      "title": "EVAP-System: großes Leck erkannt",
      "part": "Ein großes Leck in der Tankentlüftung; häufigste Ursache ist ein fehlender oder defekter Tankdeckel oder ein abgerutschter Schlauch.",
      "symptoms": "Die Motorkontrollleuchte leuchtet; rund um das Fahrzeug kann es nach Kraftstoff riechen.",
      "risk": "Zuerst den Tankdeckel kontrollieren und fest verschließen; bleibt der Geruch oder die Lampe, zügig in die Werkstatt."
    }
  },
  "P0456": {
    "tr": {
      "title": "EVAP Sistemi Kaçak Tespit Edildi (Çok Küçük Kaçak)",
      "part": "Yakıt buharı sisteminde çok küçük bir sızıntı; sık nedenler yıpranmış depo kapağı contası veya küçük bir hortum çatlağıdır.",
      "symptoms": "Hiçbir şey hissedilmez; sadece arıza lambası yanar.",
      "risk": "Sürüş için tehlikesizdir; depo kapağını sıkıca kapatın, lamba sönmezse uygun zamanda servise gösterin."
    },
    "de": {
      "title": "EVAP-System: sehr kleines Leck erkannt",
      "part": "Ein sehr kleines Leck in der Tankentlüftung; häufige Ursachen sind eine verschlissene Tankdeckeldichtung oder ein feiner Riss in einem Schlauch.",
      "symptoms": "Nichts zu spüren; nur die Motorkontrollleuchte leuchtet.",
      "risk": "Fürs Fahren ungefährlich; Tankdeckel fest verschließen und, falls die Lampe bleibt, bei Gelegenheit prüfen lassen."
    }
  },
  "P0457": {
    "tr": {
      "title": "EVAP Kaçağı Tespit Edildi (Depo Kapağı Gevşek/Açık)",
      "part": "Yakıt depo kapağı; büyük olasılıkla gevşek takılmış, açık kalmış veya contası bozulmuş.",
      "symptoms": "Arıza lambası yanar, genellikle yakıt aldıktan hemen sonra; bazen yakıt kokusu olabilir.",
      "risk": "Basit bir sorundur: depo kapağını çıkarıp tıklayana kadar sıkın; lamba birkaç gün içinde sönmezse servise gösterin."
    },
    "de": {
      "title": "EVAP-Leck erkannt (Tankdeckel lose/offen)",
      "part": "Der Tankdeckel; sehr wahrscheinlich lose aufgesetzt, offen gelassen oder mit defekter Dichtung.",
      "symptoms": "Die Motorkontrollleuchte leuchtet, oft direkt nach dem Tanken; gelegentlich Kraftstoffgeruch.",
      "risk": "Ein einfaches Problem: Tankdeckel abnehmen und bis zum Klicken festdrehen; geht die Lampe nach einigen Tagen nicht aus, prüfen lassen."
    }
  },
  "P0460": {
    "tr": {
      "title": "Yakıt Seviye Sensörü Devre Arızası",
      "part": "Depodaki yakıt miktarını ölçen şamandıra sensörü veya kablosu.",
      "symptoms": "Yakıt göstergesi yanlış gösterir, takılı kalır veya oynar; kalan menzil bilgisi güvenilmez olur.",
      "risk": "Göstergeye güvenemeyeceğiniz için yolda yakıtsız kalabilirsiniz; depoyu erken doldurun ve kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kraftstoffstandsensor: Fehler im Stromkreis",
      "part": "Der Tankgeber (Schwimmer), der die Kraftstoffmenge im Tank misst, oder seine Verkabelung.",
      "symptoms": "Die Tankanzeige zeigt falsch an, bleibt hängen oder springt; die Restreichweite ist unzuverlässig.",
      "risk": "Da die Anzeige nicht mehr verlässlich ist, kann unterwegs der Kraftstoff ausgehen; früh tanken und zeitnah prüfen lassen."
    }
  },
  "P0461": {
    "tr": {
      "title": "Yakıt Seviye Sensörü Aralık/Performans Hatası",
      "part": "Depodaki yakıt seviyesini ölçen sensör mantıksız veya değişmeyen değerler gönderiyor; şamandıra takılmış olabilir.",
      "symptoms": "Yakıt göstergesi uzun süre aynı seviyede kalır veya gerçek durumu yansıtmaz.",
      "risk": "Yanlış göstergeye güvenip yolda yakıtsız kalma riski vardır; depoyu erken doldurun ve servise gösterin."
    },
    "de": {
      "title": "Kraftstoffstandsensor: Bereichs-/Leistungsfehler",
      "part": "Der Tankgeber liefert unplausible oder unveränderte Werte; der Schwimmer kann klemmen.",
      "symptoms": "Die Tankanzeige bleibt lange auf demselben Stand oder zeigt nicht den tatsächlichen Füllstand.",
      "risk": "Wer der falschen Anzeige vertraut, kann liegenbleiben; früh tanken und in der Werkstatt prüfen lassen."
    }
  },
  "P0462": {
    "tr": {
      "title": "Yakıt Seviye Sensörü Düşük Sinyal",
      "part": "Yakıt seviye sensörünün sinyali çok düşük; sensör veya kablo arızalı olabilir.",
      "symptoms": "Yakıt göstergesi sürekli boş gösterebilir veya yakıt uyarı lambası yanlış yanabilir.",
      "risk": "Gerçek yakıt miktarını bilemezsiniz, yolda kalma riski vardır; depoyu erken doldurun ve kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kraftstoffstandsensor: Signal zu niedrig",
      "part": "Das Signal des Tankgebers ist zu niedrig; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Die Tankanzeige kann dauerhaft leer anzeigen oder die Reserveleuchte grundlos angehen.",
      "risk": "Der tatsächliche Füllstand ist unbekannt, es droht Liegenbleiben; früh tanken und zeitnah prüfen lassen."
    }
  },
  "P0463": {
    "tr": {
      "title": "Yakıt Seviye Sensörü Yüksek Sinyal",
      "part": "Yakıt seviye sensörünün sinyali çok yüksek; sensör veya kablo arızalı olabilir.",
      "symptoms": "Yakıt göstergesi depo boşalırken bile dolu gösterebilir.",
      "risk": "Depo boş olduğu halde dolu görünürse yolda yakıtsız kalabilirsiniz; kilometreye göre yakıt alın ve kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kraftstoffstandsensor: Signal zu hoch",
      "part": "Das Signal des Tankgebers ist zu hoch; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Die Tankanzeige kann voll anzeigen, obwohl der Tank sich leert.",
      "risk": "Zeigt der Tank fälschlich voll an, droht Liegenbleiben ohne Kraftstoff; nach Kilometern tanken und zeitnah prüfen lassen."
    }
  },
  "P0480": {
    "tr": {
      "title": "Soğutma Fanı 1 Kontrol Devresi Arızası",
      "part": "Radyatörü soğutan fanın (1. fan) kumanda devresi, rölesi veya kablosu.",
      "symptoms": "Motor hararet göstergesi özellikle trafikte veya dururken yükselir; klima zayıflayabilir ya da fan hiç durmadan çalışabilir.",
      "risk": "Fan çalışmazsa motor hararet yapıp ciddi hasar görebilir; hararet göstergesini izleyin, yükseliyorsa durun ve en kısa sürede servise gidin."
    },
    "de": {
      "title": "Kühlerlüfter 1: Fehler im Steuerstromkreis",
      "part": "Der Steuerstromkreis, das Relais oder die Verkabelung des ersten Kühlerlüfters.",
      "symptoms": "Die Motortemperatur steigt vor allem im Stau oder im Stand; die Klimaanlage kann schwächeln oder der Lüfter läuft ununterbrochen.",
      "risk": "Läuft der Lüfter nicht, kann der Motor überhitzen und schweren Schaden nehmen; Temperaturanzeige beobachten, bei Anstieg anhalten und schnellstmöglich in die Werkstatt."
    }
  },
  "P0481": {
    "tr": {
      "title": "Soğutma Fanı 2 Kontrol Devresi Arızası",
      "part": "İkinci soğutma fanının (veya fanın ikinci kademesinin) kumanda devresi, rölesi veya kablosu.",
      "symptoms": "Sıcak havada veya klima açıkken motor sıcaklığı yükselebilir; klima performansı düşebilir.",
      "risk": "Yoğun yükte hararet ve motor hasarı riski vardır; hararet göstergesini izleyin ve kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kühlerlüfter 2: Fehler im Steuerstromkreis",
      "part": "Der Steuerstromkreis, das Relais oder die Verkabelung des zweiten Kühlerlüfters bzw. der zweiten Lüfterstufe.",
      "symptoms": "Bei Hitze oder eingeschalteter Klimaanlage kann die Motortemperatur steigen; die Klimaleistung kann nachlassen.",
      "risk": "Unter hoher Last droht Überhitzung mit Motorschaden; Temperaturanzeige beobachten und zeitnah in die Werkstatt."
    }
  },
  "P0482": {
    "tr": {
      "title": "Soğutma Fanı 3 Kontrol Devresi Arızası",
      "part": "Üçüncü soğutma fanının (veya fanın üçüncü kademesinin) kumanda devresi, rölesi veya kablosu.",
      "symptoms": "Ağır yükte veya sıcak havada motor sıcaklığı yükselebilir; klima zayıflayabilir.",
      "risk": "Hararet ve motor hasarı riski vardır; hararet göstergesini izleyin ve kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kühlerlüfter 3: Fehler im Steuerstromkreis",
      "part": "Der Steuerstromkreis, das Relais oder die Verkabelung des dritten Kühlerlüfters bzw. der dritten Lüfterstufe.",
      "symptoms": "Bei hoher Last oder Hitze kann die Motortemperatur steigen; die Klimaanlage kann schwächeln.",
      "risk": "Es droht Überhitzung mit Motorschaden; Temperaturanzeige beobachten und zeitnah in die Werkstatt."
    }
  },
  "P0483": {
    "tr": {
      "title": "Soğutma Fanı Performans/Kontrol Doğrulama Arızası",
      "part": "Soğutma fanı beklendiği gibi çalışmıyor; fan motoru, rölesi veya kumandası sorunlu olabilir.",
      "symptoms": "Motor sıcaklığı özellikle trafikte yükselebilir veya fan sürekli yüksek devirde çalışıp gürültü yapabilir.",
      "risk": "Fan görevini yapmazsa motor hararet yapıp ciddi hasar görebilir; hararet göstergesini izleyin ve en kısa sürede servise gidin."
    },
    "de": {
      "title": "Kühlerlüfter: Funktionsprüfung fehlgeschlagen",
      "part": "Der Kühlerlüfter arbeitet nicht wie erwartet; Lüftermotor, Relais oder Ansteuerung kann defekt sein.",
      "symptoms": "Die Motortemperatur kann besonders im Stau steigen, oder der Lüfter läuft dauerhaft laut auf hoher Stufe.",
      "risk": "Erfüllt der Lüfter seine Aufgabe nicht, droht Überhitzung mit schwerem Motorschaden; Temperaturanzeige beobachten und schnellstmöglich in die Werkstatt."
    }
  },
  "P0500": {
    "tr": {
      "title": "Araç Hız Sensörü (VSS) Arızası",
      "part": "Aracın hızını ölçen sensör veya kablosu; sinyal hiç gelmiyor ya da hatalı.",
      "symptoms": "Hız göstergesi çalışmayabilir veya oynayabilir; otomatik vites sert/yanlış geçebilir, hız sabitleyici ve bazen ABS/ESP devre dışı kalabilir.",
      "risk": "Hızınızı bilememek ve vites sorunları güvenliği etkiler; aracı dikkatli kullanın ve kısa sürede servise gösterin."
    },
    "de": {
      "title": "Fahrzeuggeschwindigkeitssensor (VSS): Fehlfunktion",
      "part": "Der Sensor, der die Fahrgeschwindigkeit misst, oder seine Verkabelung; das Signal fehlt oder ist fehlerhaft.",
      "symptoms": "Der Tacho kann ausfallen oder springen; das Automatikgetriebe kann hart oder falsch schalten, Tempomat und teils ABS/ESP können ausfallen.",
      "risk": "Ohne verlässliche Geschwindigkeit und mit Schaltproblemen leidet die Sicherheit; vorsichtig fahren und zeitnah in die Werkstatt."
    }
  },
  "P0501": {
    "tr": {
      "title": "Araç Hız Sensörü Aralık/Performans Hatası",
      "part": "Hız sensörü sinyal gönderiyor ancak değerler mantıksız veya tutarsız.",
      "symptoms": "Hız göstergesi gerçek hızdan farklı gösterebilir veya dalgalanabilir; otomatik viteste geçiş sorunları olabilir.",
      "risk": "Yanlış hız bilgisi ve vites sorunları sürüşü etkiler; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Geschwindigkeitssensor: Bereichs-/Leistungsfehler",
      "part": "Der Geschwindigkeitssensor sendet ein Signal, aber die Werte sind unplausibel oder schwankend.",
      "symptoms": "Der Tacho kann von der echten Geschwindigkeit abweichen oder schwanken; beim Automatikgetriebe kann es Schaltprobleme geben.",
      "risk": "Falsche Geschwindigkeitsangaben und Schaltprobleme beeinträchtigen die Fahrt; zeitnah in der Werkstatt prüfen lassen."
    }
  },
  "P0502": {
    "tr": {
      "title": "Araç Hız Sensörü Devresi Düşük Sinyal",
      "part": "Hız sensöründen sinyal gelmiyor veya çok zayıf; sensör ya da kablo arızalı olabilir.",
      "symptoms": "Hız göstergesi sıfırda kalabilir; otomatik vites sert geçebilir, hız sabitleyici çalışmayabilir.",
      "risk": "Hız bilgisi olmadan sürüş güvenliği azalır ve şanzıman zorlanabilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Geschwindigkeitssensor: Signal zu niedrig / kein Signal",
      "part": "Vom Geschwindigkeitssensor kommt kein oder ein zu schwaches Signal; Sensor oder Kabel kann defekt sein.",
      "symptoms": "Der Tacho kann auf null bleiben; das Automatikgetriebe kann hart schalten, der Tempomat ausfallen.",
      "risk": "Ohne Geschwindigkeitsinfo sinkt die Sicherheit und das Getriebe kann leiden; zeitnah in die Werkstatt."
    }
  },
  "P0503": {
    "tr": {
      "title": "Araç Hız Sensörü Kesikli/Düzensiz Sinyal",
      "part": "Hız sensörünün sinyali kesik kesik geliyor veya ani sıçramalar yapıyor; gevşek kablo ya da arızalı sensör olabilir.",
      "symptoms": "Hız göstergesi aniden sıçrayabilir veya sıfıra düşebilir; otomatik vites beklenmedik şekilde davranabilir.",
      "risk": "Düzensiz sinyal vites ve gösterge sorunlarına yol açar; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Geschwindigkeitssensor: Signal unterbrochen/sprunghaft",
      "part": "Das Signal des Geschwindigkeitssensors setzt zeitweise aus oder springt; Ursache kann ein loses Kabel oder ein defekter Sensor sein.",
      "symptoms": "Der Tacho kann plötzlich springen oder auf null fallen; das Automatikgetriebe kann sich unerwartet verhalten.",
      "risk": "Das unruhige Signal führt zu Schalt- und Anzeigeproblemen; zeitnah in der Werkstatt prüfen lassen."
    }
  },
  "P0505": {
    "tr": {
      "title": "Rölanti Kontrol Sistemi Arızası",
      "part": "Motorun boşta çalışma devrini ayarlayan sistem (rölanti kontrol valfi veya gaz kelebeği kumandası).",
      "symptoms": "Rölanti dalgalanır, çok yüksek ya da çok düşük olur; araç dururken motor stop edebilir.",
      "risk": "Trafikte veya kavşakta motorun stop etmesi tehlike yaratabilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Leerlaufregelung: Fehlfunktion",
      "part": "Das System, das die Leerlaufdrehzahl des Motors regelt (Leerlaufregelventil oder Drosselklappensteller).",
      "symptoms": "Der Leerlauf schwankt, ist zu hoch oder zu niedrig; im Stand kann der Motor absterben.",
      "risk": "Geht der Motor im Verkehr oder an der Kreuzung aus, kann das gefährlich werden; zeitnah in die Werkstatt."
    }
  },
  "P0506": {
    "tr": {
      "title": "Rölanti Devri Beklenenden Düşük",
      "part": "Rölanti kontrol sistemi motoru olması gereken devirde tutamıyor; kirlenmiş gaz kelebeği veya hava kaçağı sık nedenlerdir.",
      "symptoms": "Motor boşta çok düşük devirde titrer; dururken veya kalkışta stop edebilir, klima açıkken belirginleşir.",
      "risk": "Trafikte ani stop etme riski vardır; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Leerlaufdrehzahl niedriger als erwartet",
      "part": "Die Leerlaufregelung hält den Motor nicht auf der Solldrehzahl; häufige Ursachen sind eine verschmutzte Drosselklappe oder Falschluft.",
      "symptoms": "Der Motor läuft im Stand zu niedrig und zittert; er kann beim Anhalten oder Anfahren absterben, besonders mit Klimaanlage.",
      "risk": "Es besteht die Gefahr, dass der Motor im Verkehr plötzlich ausgeht; zeitnah in der Werkstatt prüfen lassen."
    }
  },
  "P0507": {
    "tr": {
      "title": "Rölanti Devri Beklenenden Yüksek",
      "part": "Rölanti kontrol sistemi devri düşüremiyor; sık nedenler hava kaçağı veya takılı kalmış rölanti/gaz kelebeği mekanizmasıdır.",
      "symptoms": "Motor boşta normalden yüksek devirde çalışır; yakıt tüketimi artar, otomatik viteste araç boşta öne itebilir.",
      "risk": "Yüksek rölanti yakıt yakar ve frenlere ek yük bindirir; acil değildir ama kısa sürede servise gösterin."
    },
    "de": {
      "title": "Leerlaufdrehzahl höher als erwartet",
      "part": "Die Leerlaufregelung bekommt die Drehzahl nicht herunter; häufige Ursachen sind Falschluft oder eine klemmende Drosselklappe.",
      "symptoms": "Der Motor dreht im Stand höher als normal; der Verbrauch steigt, beim Automatikgetriebe kann das Fahrzeug im Stand schieben.",
      "risk": "Hoher Leerlauf kostet Kraftstoff und belastet die Bremsen zusätzlich; nicht akut, aber zeitnah prüfen lassen."
    }
  },
  "P0520": {
    "tr": {
      "title": "Motor Yağ Basıncı Sensörü Devre Arızası",
      "part": "Motor yağ basıncını ölçen sensör veya kablo bağlantısı.",
      "symptoms": "Gösterge panelinde yağ lambası yanabilir veya yağ basıncı göstergesi yanlış değer gösterebilir. Sürüşte belirgin bir değişiklik hissedilmeyebilir.",
      "risk": "Gerçek bir yağ basıncı sorunu fark edilmeden kalabilir ve motor ağır hasar görebilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Öldrucksensor - Fehler im Stromkreis",
      "part": "Der Sensor, der den Motoröldruck misst, oder seine Verkabelung.",
      "symptoms": "Die Öldruck-Warnleuchte kann aufleuchten oder die Anzeige falsche Werte zeigen. Beim Fahren ist oft nichts zu spüren.",
      "risk": "Ein echtes Öldruckproblem könnte unbemerkt bleiben und den Motor schwer beschädigen; zeitnah in die Werkstatt."
    }
  },
  "P0521": {
    "tr": {
      "title": "Motor Yağ Basıncı Sensörü Aralık/Performans Arızası",
      "part": "Yağ basıncı sensörü mantıksız veya beklenmeyen değerler gönderiyor.",
      "symptoms": "Yağ lambası gelip gidebilir, gösterge dalgalanabilir. Motor sesi normalse sorun genelde sensördedir.",
      "risk": "Düşük yağ basıncı uyarısı güvenilmez hale gelir; motoru korumak için en kısa sürede kontrol ettirin."
    },
    "de": {
      "title": "Öldrucksensor - Signal unplausibel (Bereich/Funktion)",
      "part": "Der Öldrucksensor liefert unlogische oder unerwartete Werte.",
      "symptoms": "Die Ölwarnleuchte kann sporadisch aufleuchten, die Anzeige schwanken. Klingt der Motor normal, liegt es meist am Sensor.",
      "risk": "Die Öldruckwarnung ist nicht mehr zuverlässig; zum Schutz des Motors bald prüfen lassen."
    }
  },
  "P0522": {
    "tr": {
      "title": "Motor Yağ Basıncı Sensörü Düşük Sinyal",
      "part": "Yağ basıncı sensöründen gelen elektrik sinyali çok düşük; sensör veya kablosu arızalı olabilir.",
      "symptoms": "Yağ basıncı lambası sürekli yanabilir veya gösterge sıfırda kalabilir.",
      "risk": "Gerçekten yağ basıncı düşükse motor kısa sürede hasar görür; lambayı ciddiye alın ve hemen kontrol ettirin."
    },
    "de": {
      "title": "Öldrucksensor - Signal zu niedrig",
      "part": "Das elektrische Signal des Öldrucksensors ist zu schwach; Sensor oder Kabel können defekt sein.",
      "symptoms": "Die Öldruckleuchte kann dauerhaft brennen oder die Anzeige bleibt auf Null.",
      "risk": "Ist der Öldruck wirklich zu niedrig, nimmt der Motor schnell Schaden; Warnung ernst nehmen und sofort prüfen lassen."
    }
  },
  "P0523": {
    "tr": {
      "title": "Motor Yağ Basıncı Sensörü Yüksek Sinyal",
      "part": "Yağ basıncı sensöründen gelen elektrik sinyali çok yüksek; genellikle sensör veya kablo hatası.",
      "symptoms": "Yağ göstergesi sürekli en üstte kalabilir veya uyarı lambası yanabilir; sürüşte fark hissedilmeyebilir.",
      "risk": "Yağ basıncı takibi güvenilmez olur ve gerçek bir sorun gizlenebilir; kısa sürede servise gidin."
    },
    "de": {
      "title": "Öldrucksensor - Signal zu hoch",
      "part": "Das elektrische Signal des Öldrucksensors ist zu hoch; meist ein Sensor- oder Kabelfehler.",
      "symptoms": "Die Öldruckanzeige kann dauerhaft am Maximum stehen oder eine Warnleuchte brennt; beim Fahren oft unauffällig.",
      "risk": "Die Öldrucküberwachung ist unzuverlässig, ein echtes Problem kann verdeckt bleiben; zeitnah zur Werkstatt."
    }
  },
  "P0524": {
    "tr": {
      "title": "Motor Yağ Basıncı Çok Düşük",
      "part": "Motorun yağlama sistemi; yağ seviyesi, yağ pompası veya yağ basıncı gerçekten düşük.",
      "symptoms": "Kırmızı yağ lambası yanar, motordan tıkırtı sesi gelebilir.",
      "risk": "ÇOK ACİL: Motor yağsız kalıp sıkışabilir. Aracı güvenli bir yerde hemen durdurun, motoru kapatın ve yola devam etmeyin."
    },
    "de": {
      "title": "Motoröldruck zu niedrig",
      "part": "Die Motorschmierung: Ölstand, Ölpumpe oder der Öldruck selbst ist tatsächlich zu niedrig.",
      "symptoms": "Die rote Ölwarnleuchte brennt, der Motor kann klackern oder rasseln.",
      "risk": "SEHR DRINGEND: Der Motor kann ohne Schmierung festgehen. Sofort sicher anhalten, Motor abstellen und nicht weiterfahren."
    }
  },
  "P0560": {
    "tr": {
      "title": "Sistem Voltajı Arızası",
      "part": "Aracın elektrik sistemi: akü, alternatör (şarj dinamosu) veya kablolar.",
      "symptoms": "Uyarı lambaları yanabilir, farlar kararabilir, gösterge veya elektronik sistemler tuhaf davranabilir.",
      "risk": "Akü boşalabilir, araç yolda stop edebilir veya çalışmayabilir; en kısa sürede kontrol ettirin."
    },
    "de": {
      "title": "Bordspannung - Fehlfunktion",
      "part": "Die Fahrzeugelektrik: Batterie, Lichtmaschine oder Verkabelung.",
      "symptoms": "Warnleuchten können angehen, Scheinwerfer flackern oder dunkler werden, elektronische Systeme spinnen.",
      "risk": "Die Batterie kann sich entladen, das Fahrzeug unterwegs ausgehen oder nicht mehr starten; bald prüfen lassen."
    }
  },
  "P0561": {
    "tr": {
      "title": "Sistem Voltajı Kararsız",
      "part": "Şarj sistemi (alternatör/akü) düzensiz voltaj üretiyor; genellikle alternatör regülatörü veya gevşek bağlantı.",
      "symptoms": "Farlar ve iç aydınlatma titreyebilir, uyarı lambaları gelip gidebilir, elektronik cihazlar arada kapanabilir.",
      "risk": "Elektronik parçalar zarar görebilir ve araç yolda kalabilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Bordspannung instabil",
      "part": "Das Ladesystem (Lichtmaschine/Batterie) liefert schwankende Spannung; oft der Regler oder eine lose Verbindung.",
      "symptoms": "Scheinwerfer und Innenlicht können flackern, Warnleuchten kommen und gehen, Elektronik fällt zeitweise aus.",
      "risk": "Elektronikbauteile können Schaden nehmen und das Fahrzeug liegenbleiben; zeitnah in die Werkstatt."
    }
  },
  "P0562": {
    "tr": {
      "title": "Sistem Voltajı Düşük",
      "part": "Şarj sistemi yeterli voltaj üretmiyor: alternatör zayıf, akü bitik veya kayış/kablo sorunlu.",
      "symptoms": "Akü/şarj lambası yanabilir, farlar sönük kalır, marş zayıflar, elektrikli donanımlar yavaş çalışır.",
      "risk": "Akü tamamen boşalır ve araç yolda kalır; uzun yola çıkmadan önce mutlaka kontrol ettirin."
    },
    "de": {
      "title": "Bordspannung zu niedrig",
      "part": "Das Ladesystem liefert zu wenig Spannung: schwache Lichtmaschine, leere Batterie oder Riemen-/Kabelproblem.",
      "symptoms": "Die Batteriewarnleuchte kann brennen, Licht ist schwach, der Anlasser dreht müde, elektrische Verbraucher arbeiten träge.",
      "risk": "Die Batterie entlädt sich vollständig und das Fahrzeug bleibt liegen; vor längeren Fahrten unbedingt prüfen lassen."
    }
  },
  "P0563": {
    "tr": {
      "title": "Sistem Voltajı Yüksek",
      "part": "Şarj sistemi aşırı voltaj üretiyor; genellikle alternatörün voltaj regülatörü arızalı.",
      "symptoms": "Ampuller sık yanabilir, farlar aşırı parlak olabilir, akü kokusu veya kaynama görülebilir.",
      "risk": "Aşırı voltaj aküyü ve araç elektroniğini bozabilir, pahalı hasara yol açar; gecikmeden servise gidin."
    },
    "de": {
      "title": "Bordspannung zu hoch",
      "part": "Das Ladesystem erzeugt zu viel Spannung; meist ist der Spannungsregler der Lichtmaschine defekt.",
      "symptoms": "Glühlampen brennen häufig durch, Licht ist übermäßig hell, die Batterie kann riechen oder kochen.",
      "risk": "Überspannung kann Batterie und Fahrzeugelektronik zerstören und teure Schäden verursachen; ohne Verzögerung zur Werkstatt."
    }
  },
  "P0565": {
    "tr": {
      "title": "Hız Sabitleyici Açma Sinyali Arızası",
      "part": "Hız sabitleyicinin (cruise control) açma düğmesi veya sinyal kablosu.",
      "symptoms": "Hız sabitleyici devreye girmeyebilir veya kendiliğinden kapanabilir. Aracın sürüşü etkilenmez.",
      "risk": "Güvenlik riski düşüktür, sadece konfor özelliği çalışmaz; bir sonraki bakımda baktırılabilir."
    },
    "de": {
      "title": "Tempomat-Einschaltsignal fehlerhaft",
      "part": "Der Einschalter des Tempomaten oder dessen Signalleitung.",
      "symptoms": "Der Tempomat lässt sich eventuell nicht aktivieren oder schaltet sich von selbst ab. Das Fahrverhalten bleibt normal.",
      "risk": "Geringes Risiko, nur eine Komfortfunktion fällt aus; kann beim nächsten Service geprüft werden."
    }
  },
  "P0600": {
    "tr": {
      "title": "Seri İletişim Hattı Arızası",
      "part": "Araçtaki kontrol üniteleri arasındaki veri iletişim hattı (ör. CAN hattı) veya bağlantıları.",
      "symptoms": "Birden fazla uyarı lambası aynı anda yanabilir, göstergeler tuhaf davranabilir, bazı sistemler devre dışı kalabilir.",
      "risk": "Araç sistemleri birbirini göremez, beklenmedik arızalar oluşabilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Serielle Kommunikationsverbindung gestört",
      "part": "Die Datenleitung zwischen den Steuergeräten des Fahrzeugs (z. B. CAN-Bus) oder deren Anschlüsse.",
      "symptoms": "Mehrere Warnleuchten können gleichzeitig angehen, Anzeigen verhalten sich seltsam, einzelne Systeme fallen aus.",
      "risk": "Die Fahrzeugsysteme können nicht mehr miteinander kommunizieren, unvorhersehbare Störungen sind möglich; zeitnah zur Werkstatt."
    }
  },
  "P0601": {
    "tr": {
      "title": "Kontrol Ünitesi İç Hafıza Sağlama Hatası",
      "part": "Motor beyni (ECU) kendi iç hafızasında hata tespit etti.",
      "symptoms": "Motor arıza lambası yanar; motor düzensiz çalışabilir, stop edebilir veya hiç belirti olmayabilir.",
      "risk": "Beyin hatalı kararlar verebilir, araç beklenmedik şekilde davranabilir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Steuergerät - interner Speicherfehler (Prüfsumme)",
      "part": "Das Motorsteuergerät (ECU) hat einen Fehler in seinem internen Speicher festgestellt.",
      "symptoms": "Die Motorkontrollleuchte brennt; der Motor kann unruhig laufen, ausgehen oder völlig unauffällig sein.",
      "risk": "Das Steuergerät kann falsche Entscheidungen treffen und das Fahrzeug unberechenbar reagieren; möglichst bald zur Werkstatt."
    }
  },
  "P0602": {
    "tr": {
      "title": "Kontrol Ünitesi Programlama Hatası",
      "part": "Motor beyninin (ECU) yazılımı eksik veya hatalı yüklenmiş.",
      "symptoms": "Motor arıza lambası yanar; araç çalışmayabilir veya bazı fonksiyonlar devre dışı kalabilir.",
      "risk": "Sorun genellikle yazılım güncellemesi/yeniden programlama ile çözülür; yetkili servise gösterin."
    },
    "de": {
      "title": "Steuergerät - Programmierfehler",
      "part": "Die Software des Motorsteuergeräts ist unvollständig oder fehlerhaft aufgespielt.",
      "symptoms": "Die Motorkontrollleuchte brennt; das Fahrzeug startet eventuell nicht oder einzelne Funktionen fallen aus.",
      "risk": "Das Problem wird meist durch ein Software-Update bzw. Neuprogrammieren behoben; in einer Fachwerkstatt prüfen lassen."
    }
  },
  "P0603": {
    "tr": {
      "title": "Kontrol Ünitesi Kalıcı Hafıza (KAM) Hatası",
      "part": "Motor beyninin öğrenilmiş ayarları sakladığı kalıcı hafıza; sık nedeni zayıf akü veya kesilen besleme.",
      "symptoms": "Motor bir süre düzensiz çalışabilir veya rölanti dalgalanabilir; beyin ayarları yeniden öğrenene kadar sürüş tuhaf gelebilir.",
      "risk": "Tek başına acil değildir ama tekrarlıyorsa akü/kablo veya beyin sorununa işaret eder; kontrol ettirin."
    },
    "de": {
      "title": "Steuergerät - Fehler im Erhaltungsspeicher (KAM)",
      "part": "Der Dauerspeicher, in dem das Steuergerät gelernte Werte ablegt; häufige Ursache ist eine schwache Batterie oder unterbrochene Stromversorgung.",
      "symptoms": "Der Motor kann vorübergehend unruhig laufen oder der Leerlauf schwanken, bis das Steuergerät die Werte neu gelernt hat.",
      "risk": "Allein nicht akut, aber bei Wiederholung Hinweis auf Batterie-, Kabel- oder Steuergerätproblem; prüfen lassen."
    }
  },
  "P0604": {
    "tr": {
      "title": "Kontrol Ünitesi RAM Hafıza Hatası",
      "part": "Motor beyninin geçici çalışma hafızasında (RAM) iç arıza.",
      "symptoms": "Motor arıza lambası yanar; motor teklemesi, stop etme veya güç kaybı görülebilir.",
      "risk": "Beyin arızası araç davranışını öngörülemez yapar; en kısa sürede servise gösterin."
    },
    "de": {
      "title": "Steuergerät - Fehler im Arbeitsspeicher (RAM)",
      "part": "Ein interner Defekt im Arbeitsspeicher des Motorsteuergeräts.",
      "symptoms": "Die Motorkontrollleuchte brennt; Ruckeln, Ausgehen des Motors oder Leistungsverlust sind möglich.",
      "risk": "Ein Steuergerätefehler macht das Fahrzeugverhalten unberechenbar; möglichst bald in die Werkstatt."
    }
  },
  "P0605": {
    "tr": {
      "title": "Kontrol Ünitesi ROM Hafıza Hatası",
      "part": "Motor beyninin kalıcı program hafızasında (ROM) iç arıza.",
      "symptoms": "Motor arıza lambası yanar; araç düzensiz çalışabilir veya bazı sistemler devre dışı kalabilir.",
      "risk": "Genellikle beyin yazılımı ya da beynin kendisi değişmelidir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Steuergerät - Fehler im Festwertspeicher (ROM)",
      "part": "Ein interner Defekt im Programmspeicher (ROM) des Motorsteuergeräts.",
      "symptoms": "Die Motorkontrollleuchte brennt; der Motor kann unrund laufen oder einzelne Systeme fallen aus.",
      "risk": "Meist muss die Software oder das Steuergerät selbst erneuert werden; zeitnah zur Werkstatt."
    }
  },
  "P0606": {
    "tr": {
      "title": "Motor Beyni (ECM/PCM) İşlemci Arızası",
      "part": "Motor kontrol ünitesinin ana işlemcisi kendi içinde hata tespit etti.",
      "symptoms": "Motor arıza lambası yanar; stop etme, çalışmama, güç kaybı veya hiç belirti olmayabilir.",
      "risk": "Beyin her an devre dışı kalabilir ve araç yolda kalabilir; gecikmeden servise gösterin."
    },
    "de": {
      "title": "Motorsteuergerät (ECM/PCM) - Prozessorfehler",
      "part": "Der Hauptprozessor des Motorsteuergeräts hat einen internen Fehler festgestellt.",
      "symptoms": "Die Motorkontrollleuchte brennt; Ausgehen, Startprobleme, Leistungsverlust oder gar keine Symptome sind möglich.",
      "risk": "Das Steuergerät kann jederzeit ausfallen und das Fahrzeug liegenbleiben; ohne Verzögerung in die Werkstatt."
    }
  },
  "P0620": {
    "tr": {
      "title": "Alternatör Kontrol Devresi Arızası",
      "part": "Şarj dinamosunun (alternatör) kontrol devresi veya kablo bağlantısı.",
      "symptoms": "Akü/şarj lambası yanabilir, farlar kararabilir, akü zamanla boşalabilir.",
      "risk": "Akü şarj olmazsa araç yolda kalır; kısa sürede kontrol ettirin."
    },
    "de": {
      "title": "Generator (Lichtmaschine) - Fehler im Steuerstromkreis",
      "part": "Der Steuerstromkreis der Lichtmaschine oder dessen Verkabelung.",
      "symptoms": "Die Batteriewarnleuchte kann brennen, das Licht dunkler werden, die Batterie sich allmählich entladen.",
      "risk": "Wird die Batterie nicht geladen, bleibt das Fahrzeug liegen; zeitnah prüfen lassen."
    }
  },
  "P0625": {
    "tr": {
      "title": "Alternatör Uyartım (Field) Devresi Düşük Sinyal",
      "part": "Alternatörün iç uyartım devresi veya kablosu; sinyal olması gerekenden düşük.",
      "symptoms": "Şarj lambası yanabilir, akü yeterince şarj olmaz, elektrik donanımları zayıflar.",
      "risk": "Akü boşalıp araç yolda kalabilir; uzun sürüşten önce kontrol ettirin."
    },
    "de": {
      "title": "Generator-Erregerstromkreis - Signal zu niedrig",
      "part": "Der Erregerstromkreis der Lichtmaschine oder dessen Kabel; das Signal ist niedriger als vorgesehen.",
      "symptoms": "Die Ladekontrollleuchte kann brennen, die Batterie wird nicht richtig geladen, elektrische Verbraucher schwächeln.",
      "risk": "Die Batterie kann sich entladen und das Fahrzeug liegenbleiben; vor längeren Fahrten prüfen lassen."
    }
  },
  "P0626": {
    "tr": {
      "title": "Alternatör Uyartım (Field) Devresi Yüksek Sinyal",
      "part": "Alternatörün iç uyartım devresi veya kablosu; sinyal olması gerekenden yüksek.",
      "symptoms": "Şarj lambası yanabilir, aşırı şarj nedeniyle ampuller sık atabilir, akü ısınabilir.",
      "risk": "Aşırı şarj aküye ve elektroniğe zarar verebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Generator-Erregerstromkreis - Signal zu hoch",
      "part": "Der Erregerstromkreis der Lichtmaschine oder dessen Kabel; das Signal ist höher als vorgesehen.",
      "symptoms": "Die Ladekontrollleuchte kann brennen, durch Überladung brennen Lampen häufiger durch, die Batterie kann heiß werden.",
      "risk": "Überladung kann Batterie und Elektronik beschädigen; zeitnah in die Werkstatt."
    }
  },
  "P0700": {
    "tr": {
      "title": "Şanzıman Kontrol Sistemi Arızası (Genel Kod)",
      "part": "Otomatik şanzımanın kontrol ünitesi bir arıza kaydetti; bu kod genel uyarıdır, asıl arıza şanzıman beyninde saklıdır.",
      "symptoms": "Motor arıza lambası yanar; vites geçişleri sertleşebilir veya araç emniyet moduna (tek vites) geçebilir.",
      "risk": "Altta yatan şanzıman arızası büyüyebilir; detaylı arıza taraması için kısa sürede servise gidin."
    },
    "de": {
      "title": "Getriebesteuerung - Fehlfunktion (Sammelcode)",
      "part": "Das Steuergerät des Automatikgetriebes hat einen Fehler gespeichert; dieser Code ist nur der Hinweis, der eigentliche Fehler steht im Getriebesteuergerät.",
      "symptoms": "Die Motorkontrollleuchte brennt; Schaltvorgänge können hart werden oder das Fahrzeug geht in den Notlauf (nur ein Gang).",
      "risk": "Der zugrunde liegende Getriebefehler kann sich verschlimmern; für eine genaue Diagnose zeitnah in die Werkstatt."
    }
  },
  "P0701": {
    "tr": {
      "title": "Şanzıman Kontrol Sistemi Aralık/Performans Arızası",
      "part": "Şanzıman kontrol sistemi beklenen aralığın dışında çalışıyor; sensör, kablo veya şanzıman beyni kaynaklı olabilir.",
      "symptoms": "Sert veya gecikmeli vites geçişleri, düzensiz şanzıman davranışı görülebilir.",
      "risk": "Şanzımanda kalıcı hasar oluşabilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Getriebesteuerung - Bereichs-/Funktionsfehler",
      "part": "Die Getriebesteuerung arbeitet außerhalb des erwarteten Bereichs; Ursache kann ein Sensor, Kabel oder das Getriebesteuergerät sein.",
      "symptoms": "Harte oder verzögerte Schaltvorgänge und unregelmäßiges Getriebeverhalten sind möglich.",
      "risk": "Es können bleibende Getriebeschäden entstehen; zeitnah prüfen lassen."
    }
  },
  "P0702": {
    "tr": {
      "title": "Şanzıman Kontrol Sistemi Elektrik Arızası",
      "part": "Şanzıman kontrol sisteminin elektrik devresi: kablolar, soketler veya şanzıman beyni.",
      "symptoms": "Vites geçişleri sertleşebilir, araç emniyet moduna geçebilir, vites göstergesi hatalı olabilir.",
      "risk": "Şanzıman aniden emniyet moduna geçebilir ve sürüş zorlaşır; kısa sürede servise gidin."
    },
    "de": {
      "title": "Getriebesteuerung - elektrischer Fehler",
      "part": "Der elektrische Kreis der Getriebesteuerung: Kabel, Stecker oder das Getriebesteuergerät.",
      "symptoms": "Schaltvorgänge können hart werden, das Fahrzeug kann in den Notlauf gehen, die Ganganzeige falsch sein.",
      "risk": "Das Getriebe kann plötzlich in den Notlauf schalten und das Fahren erschweren; zeitnah zur Werkstatt."
    }
  },
  "P0703": {
    "tr": {
      "title": "Fren Şalteri B Devre Arızası",
      "part": "Fren pedalına basıldığını algılayan şalter (fren müşürü) veya kablosu.",
      "symptoms": "Fren lambaları yanmayabilir veya sürekli yanabilir, hız sabitleyici çalışmayabilir, otomatik viteste geçiş sorunları olabilir.",
      "risk": "Fren lambaları çalışmıyorsa arkadan çarpılma riski ciddidir; güvenlik için hemen kontrol ettirin."
    },
    "de": {
      "title": "Bremsschalter B - Fehler im Stromkreis",
      "part": "Der Schalter, der das Treten des Bremspedals erkennt (Bremslichtschalter), oder seine Verkabelung.",
      "symptoms": "Die Bremslichter können ausfallen oder dauerhaft leuchten, der Tempomat funktioniert nicht, beim Automatikgetriebe sind Schaltprobleme möglich.",
      "risk": "Ohne funktionierende Bremslichter besteht ernste Auffahrgefahr; aus Sicherheitsgründen sofort prüfen lassen."
    }
  },
  "P0705": {
    "tr": {
      "title": "Vites Konum Sensörü (PRNDL) Devre Arızası",
      "part": "Otomatik şanzımanda hangi viteste olduğunuzu algılayan sensör veya kablosu.",
      "symptoms": "Vites göstergesi yanlış gösterebilir, araç park/boşta çalışmayabilir, geri vites lambaları yanmayabilir.",
      "risk": "Araç beklenmedik viteste hareket edebilir, bu tehlikelidir; en kısa sürede servise gösterin."
    },
    "de": {
      "title": "Getriebe-Wählhebelsensor (PRNDL) - Stromkreisfehler",
      "part": "Der Sensor, der beim Automatikgetriebe die gewählte Fahrstufe erkennt, oder seine Verkabelung.",
      "symptoms": "Die Ganganzeige kann falsch sein, das Fahrzeug startet eventuell nicht in P/N, die Rückfahrleuchten funktionieren nicht.",
      "risk": "Das Fahrzeug kann in einer unerwarteten Fahrstufe anfahren, das ist gefährlich; möglichst bald in die Werkstatt."
    }
  },
  "P0710": {
    "tr": {
      "title": "Şanzıman Yağı Sıcaklık Sensörü Devre Arızası",
      "part": "Otomatik şanzıman yağının sıcaklığını ölçen sensör veya kablosu.",
      "symptoms": "Sert veya gecikmeli vites geçişleri, özellikle soğuk havada tuhaf şanzıman davranışı görülebilir.",
      "risk": "Şanzıman aşırı ısınma korumasız kalabilir ve hasar görebilir; kısa sürede kontrol ettirin."
    },
    "de": {
      "title": "Getriebeöl-Temperatursensor - Stromkreisfehler",
      "part": "Der Sensor, der die Temperatur des Automatikgetriebeöls misst, oder seine Verkabelung.",
      "symptoms": "Harte oder verzögerte Schaltvorgänge, besonders bei Kälte kann sich das Getriebe seltsam verhalten.",
      "risk": "Das Getriebe ist ohne Überhitzungsschutz und kann Schaden nehmen; zeitnah prüfen lassen."
    }
  },
  "P0715": {
    "tr": {
      "title": "Şanzıman Giriş/Türbin Devir Sensörü Devre Arızası",
      "part": "Şanzımana giren devri ölçen sensör veya kablosu.",
      "symptoms": "Sert, gecikmeli veya düzensiz vites geçişleri; araç emniyet moduna geçebilir, kilometre göstergesi etkilenebilir.",
      "risk": "Yanlış vites geçişleri şanzımana zarar verebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Turbinen-/Eingangsdrehzahlsensor - Stromkreisfehler",
      "part": "Der Sensor, der die Eingangsdrehzahl des Getriebes misst, oder seine Verkabelung.",
      "symptoms": "Harte, verzögerte oder unregelmäßige Schaltvorgänge; Notlauf möglich, auch der Tacho kann betroffen sein.",
      "risk": "Falsche Schaltvorgänge können das Getriebe beschädigen; zeitnah in die Werkstatt."
    }
  },
  "P0720": {
    "tr": {
      "title": "Şanzıman Çıkış Devir Sensörü Devre Arızası",
      "part": "Şanzımandan tekerleklere giden devri ölçen sensör veya kablosu.",
      "symptoms": "Kilometre göstergesi hatalı veya sıfır gösterebilir, vites geçişleri bozulabilir, araç emniyet moduna geçebilir.",
      "risk": "Yanlış vites seçimi şanzımanı yıpratır ve hız bilgisi güvenilmez olur; kısa sürede kontrol ettirin."
    },
    "de": {
      "title": "Abtriebsdrehzahlsensor - Stromkreisfehler",
      "part": "Der Sensor, der die Ausgangsdrehzahl des Getriebes Richtung Räder misst, oder seine Verkabelung.",
      "symptoms": "Der Tacho kann falsch oder gar nichts anzeigen, Schaltvorgänge werden unsauber, Notlauf ist möglich.",
      "risk": "Falsche Gangwahl verschleißt das Getriebe und die Geschwindigkeitsanzeige ist unzuverlässig; zeitnah prüfen lassen."
    }
  },
  "P0725": {
    "tr": {
      "title": "Motor Devri Giriş Sinyali Devre Arızası",
      "part": "Şanzıman beynine motor devrini bildiren sinyal hattı veya sensörü.",
      "symptoms": "Düzensiz veya sert vites geçişleri; şanzıman doğru zamanda vites değiştiremeyebilir.",
      "risk": "Sürekli hatalı geçişler şanzımanı yıpratır; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Motordrehzahl-Eingangssignal - Stromkreisfehler",
      "part": "Die Signalleitung oder der Sensor, der dem Getriebesteuergerät die Motordrehzahl meldet.",
      "symptoms": "Unregelmäßige oder harte Schaltvorgänge; das Getriebe schaltet eventuell nicht zum richtigen Zeitpunkt.",
      "risk": "Dauerhaft falsche Schaltvorgänge verschleißen das Getriebe; zeitnah zur Werkstatt."
    }
  },
  "P0730": {
    "tr": {
      "title": "Hatalı Vites Oranı",
      "part": "Otomatik şanzımanın içi: vites oranı beklenenle uyuşmuyor; sık nedenler düşük/eski şanzıman yağı veya iç aşınma.",
      "symptoms": "Vites kaydırması (motor devri yükselir ama hız artmaz), sert geçişler, vites atlamama.",
      "risk": "Şanzıman içten hasar görüyor olabilir ve tamiri çok pahalıdır; gecikmeden servise gidin."
    },
    "de": {
      "title": "Falsches Übersetzungsverhältnis",
      "part": "Das Innere des Automatikgetriebes: Das Übersetzungsverhältnis stimmt nicht mit dem Sollwert überein; häufig zu wenig/altes Getriebeöl oder innerer Verschleiß.",
      "symptoms": "Durchrutschen der Gänge (Drehzahl steigt, Tempo nicht), harte Schaltvorgänge, Gänge werden nicht eingelegt.",
      "risk": "Das Getriebe kann innerlich Schaden nehmen, die Reparatur ist sehr teuer; ohne Verzögerung in die Werkstatt."
    }
  },
  "P0740": {
    "tr": {
      "title": "Tork Konvertörü Kilit Kavraması Devre Arızası",
      "part": "Otomatik şanzımanda motor ile şanzımanı doğrudan kilitleyen kavramanın kumanda devresi.",
      "symptoms": "Yüksek yakıt tüketimi, seyir hızında motor devrinin normalden yüksek kalması, titreme veya durunca stop etme.",
      "risk": "Yakıt maliyeti artar ve şanzıman aşırı ısınabilir; kısa sürede kontrol ettirin."
    },
    "de": {
      "title": "Wandlerkupplung - Fehler im Stromkreis",
      "part": "Der Ansteuerkreis der Kupplung, die im Automatikgetriebe Motor und Getriebe direkt verbindet.",
      "symptoms": "Erhöhter Verbrauch, bei Reisegeschwindigkeit bleibt die Drehzahl höher als normal, Rütteln oder Ausgehen beim Anhalten.",
      "risk": "Die Kraftstoffkosten steigen und das Getriebe kann überhitzen; zeitnah prüfen lassen."
    }
  },
  "P0741": {
    "tr": {
      "title": "Tork Konvertörü Kavraması Performans Arızası / Kilitlenmiyor",
      "part": "Motor ile şanzımanı doğrudan kilitleyen kavrama devreye girmiyor veya kayıyor.",
      "symptoms": "Otoyolda motor devri olması gerekenden yüksek kalır, yakıt tüketimi artar, hafif titreme hissedilebilir.",
      "risk": "Sürekli kayma şanzıman yağını aşırı ısıtır ve içten hasara yol açar; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Wandlerkupplung - Funktionsfehler / kuppelt nicht ein",
      "part": "Die Kupplung, die Motor und Getriebe direkt verbindet, greift nicht oder rutscht durch.",
      "symptoms": "Auf der Autobahn bleibt die Drehzahl höher als nötig, der Verbrauch steigt, leichtes Rütteln ist möglich.",
      "risk": "Ständiges Durchrutschen überhitzt das Getriebeöl und führt zu inneren Schäden; zeitnah in die Werkstatt."
    }
  },
  "P0743": {
    "tr": {
      "title": "Tork Konvertörü Kavraması Elektrik Arızası",
      "part": "Kilitleme kavramasını kumanda eden selenoidin elektrik devresi veya kablosu.",
      "symptoms": "Yüksek yakıt tüketimi, seyirde yüksek motor devri, sert geçişler veya dururken stop etme görülebilir.",
      "risk": "Şanzıman ısınabilir ve yakıt maliyeti artar; kısa sürede kontrol ettirin."
    },
    "de": {
      "title": "Wandlerkupplung - elektrischer Fehler",
      "part": "Der elektrische Kreis oder das Kabel des Magnetventils, das die Wandlerkupplung ansteuert.",
      "symptoms": "Erhöhter Verbrauch, hohe Drehzahl bei konstanter Fahrt, harte Schaltvorgänge oder Ausgehen beim Anhalten.",
      "risk": "Das Getriebe kann überhitzen und die Kraftstoffkosten steigen; zeitnah prüfen lassen."
    }
  },
  "P0750": {
    "tr": {
      "title": "Vites Selenoidi A Arızası",
      "part": "Otomatik şanzımanda vites geçişlerini yöneten elektrikli valflerden (selenoid) biri veya kablosu.",
      "symptoms": "Bazı vitesler atlanabilir, geçişler sertleşebilir, araç emniyet moduna geçebilir.",
      "risk": "Yanlış vites geçişleri şanzımana zarar verir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Schaltmagnetventil A - Fehlfunktion",
      "part": "Eines der elektrischen Ventile (Magnetventile), die im Automatikgetriebe die Gangwechsel steuern, oder seine Verkabelung.",
      "symptoms": "Einzelne Gänge können übersprungen werden, Schaltvorgänge werden hart, Notlauf ist möglich.",
      "risk": "Fehlerhafte Schaltvorgänge beschädigen das Getriebe; zeitnah in die Werkstatt."
    }
  },
  "P0755": {
    "tr": {
      "title": "Vites Selenoidi B Arızası",
      "part": "Otomatik şanzımanda vites geçişlerini yöneten ikinci elektrikli valf (selenoid) veya kablosu.",
      "symptoms": "Bazı vitesler devreye girmeyebilir, geçişler sert veya gecikmeli olabilir, araç emniyet moduna geçebilir.",
      "risk": "Yanlış vites geçişleri şanzımanı yıpratır; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Schaltmagnetventil B - Fehlfunktion",
      "part": "Das zweite elektrische Ventil (Magnetventil), das im Automatikgetriebe die Gangwechsel steuert, oder seine Verkabelung.",
      "symptoms": "Einzelne Gänge lassen sich eventuell nicht einlegen, Schaltvorgänge sind hart oder verzögert, Notlauf ist möglich.",
      "risk": "Fehlerhafte Schaltvorgänge verschleißen das Getriebe; zeitnah in die Werkstatt."
    }
  },
  "P2002": {
    "tr": {
      "title": "Dizel Partikül Filtresi (DPF) Verimi Düşük (Sıra 1)",
      "part": "Egzozdaki kurumu tutan dizel partikül filtresi (DPF) veya sensörleri.",
      "symptoms": "Güç kaybı, artan yakıt tüketimi, DPF uyarı lambası; sık rejenerasyon fark edilebilir.",
      "risk": "Filtre tamamen tıkanırsa pahalı değişim gerekebilir ve araç acil moda geçer; kısa yolculuklardan kaçının, yakında servise gösterin."
    },
    "de": {
      "title": "Dieselpartikelfilter (DPF) Wirkungsgrad zu gering (Bank 1)",
      "part": "Der Dieselpartikelfilter im Auspuff, der Rußpartikel zurückhält, oder seine Sensoren.",
      "symptoms": "Leistungsverlust, höherer Verbrauch, DPF-Warnleuchte; häufige Regenerationen können auffallen.",
      "risk": "Ein komplett verstopfter Filter bedeutet teuren Austausch und Notlauf; Kurzstrecken meiden und bald zur Werkstatt."
    }
  },
  "P2003": {
    "tr": {
      "title": "Dizel Partikül Filtresi (DPF) Verimi Düşük (Sıra 2)",
      "part": "Egzozun 2. sırasındaki kurumu tutan dizel partikül filtresi (DPF) veya sensörleri.",
      "symptoms": "Güç kaybı, artan yakıt tüketimi, DPF uyarı lambası; sık rejenerasyon fark edilebilir.",
      "risk": "Filtre tamamen tıkanırsa pahalı değişim gerekebilir ve araç acil moda geçer; kısa yolculuklardan kaçının, yakında servise gösterin."
    },
    "de": {
      "title": "Dieselpartikelfilter (DPF) Wirkungsgrad zu gering (Bank 2)",
      "part": "Der Dieselpartikelfilter auf Bank 2 des Auspuffs, der Rußpartikel zurückhält, oder seine Sensoren.",
      "symptoms": "Leistungsverlust, höherer Verbrauch, DPF-Warnleuchte; häufige Regenerationen können auffallen.",
      "risk": "Ein komplett verstopfter Filter bedeutet teuren Austausch und Notlauf; Kurzstrecken meiden und bald zur Werkstatt."
    }
  },
  "P2096": {
    "tr": {
      "title": "Katalizör Sonrası Karışım Çok Fakir (Sıra 1)",
      "part": "Katalizör arkasındaki oksijen (lambda) sensörünün ölçtüğü yakıt-hava karışımı; sık nedenler egzoz kaçağı, sensör veya yakıt sistemi sorunu.",
      "symptoms": "Çoğu zaman az hissedilir; hafif güç kaybı, düzensiz rölanti veya artan tüketim olabilir.",
      "risk": "Uzun süre sürülürse katalizör zarar görebilir ve egzoz muayenesinden kalınır; yakında servise gösterin."
    },
    "de": {
      "title": "Gemisch nach Katalysator zu mager (Bank 1)",
      "part": "Das Kraftstoff-Luft-Gemisch, gemessen von der Lambdasonde hinter dem Katalysator; häufige Ursachen sind Abgasleck, Sonde oder Kraftstoffsystem.",
      "symptoms": "Oft kaum spürbar; leichter Leistungsverlust, unruhiger Leerlauf oder höherer Verbrauch möglich.",
      "risk": "Auf Dauer kann der Katalysator Schaden nehmen und die Abgasuntersuchung scheitern; bald in die Werkstatt."
    }
  },
  "P2097": {
    "tr": {
      "title": "Katalizör Sonrası Karışım Çok Zengin (Sıra 1)",
      "part": "Katalizör arkasındaki oksijen (lambda) sensörünün ölçtüğü yakıt-hava karışımı; motor fazla yakıt alıyor.",
      "symptoms": "Artan yakıt tüketimi, yakıt kokusu, bazen siyah duman veya düzensiz rölanti.",
      "risk": "Fazla yakıt katalizöre zarar verebilir ve maliyeti artırır; yakında servise gösterin."
    },
    "de": {
      "title": "Gemisch nach Katalysator zu fett (Bank 1)",
      "part": "Das Kraftstoff-Luft-Gemisch, gemessen von der Lambdasonde hinter dem Katalysator; der Motor bekommt zu viel Kraftstoff.",
      "symptoms": "Höherer Verbrauch, Kraftstoffgeruch, teils schwarzer Rauch oder unruhiger Leerlauf.",
      "risk": "Zu viel Kraftstoff kann den Katalysator beschädigen und erhöht die Kosten; bald in die Werkstatt."
    }
  },
  "P2098": {
    "tr": {
      "title": "Katalizör Sonrası Karışım Çok Fakir (Sıra 2)",
      "part": "2. sıradaki katalizör arkasındaki oksijen (lambda) sensörünün ölçtüğü yakıt-hava karışımı; sık nedenler egzoz kaçağı, sensör veya yakıt sistemi sorunu.",
      "symptoms": "Çoğu zaman az hissedilir; hafif güç kaybı, düzensiz rölanti veya artan tüketim olabilir.",
      "risk": "Uzun süre sürülürse katalizör zarar görebilir ve egzoz muayenesinden kalınır; yakında servise gösterin."
    },
    "de": {
      "title": "Gemisch nach Katalysator zu mager (Bank 2)",
      "part": "Das Kraftstoff-Luft-Gemisch, gemessen von der Lambdasonde hinter dem Katalysator auf Bank 2; häufige Ursachen sind Abgasleck, Sonde oder Kraftstoffsystem.",
      "symptoms": "Oft kaum spürbar; leichter Leistungsverlust, unruhiger Leerlauf oder höherer Verbrauch möglich.",
      "risk": "Auf Dauer kann der Katalysator Schaden nehmen und die Abgasuntersuchung scheitern; bald in die Werkstatt."
    }
  },
  "P2099": {
    "tr": {
      "title": "Katalizör Sonrası Karışım Çok Zengin (Sıra 2)",
      "part": "2. sıradaki katalizör arkasındaki oksijen (lambda) sensörünün ölçtüğü yakıt-hava karışımı; motor fazla yakıt alıyor.",
      "symptoms": "Artan yakıt tüketimi, yakıt kokusu, bazen siyah duman veya düzensiz rölanti.",
      "risk": "Fazla yakıt katalizöre zarar verebilir ve maliyeti artırır; yakında servise gösterin."
    },
    "de": {
      "title": "Gemisch nach Katalysator zu fett (Bank 2)",
      "part": "Das Kraftstoff-Luft-Gemisch, gemessen von der Lambdasonde hinter dem Katalysator auf Bank 2; der Motor bekommt zu viel Kraftstoff.",
      "symptoms": "Höherer Verbrauch, Kraftstoffgeruch, teils schwarzer Rauch oder unruhiger Leerlauf.",
      "risk": "Zu viel Kraftstoff kann den Katalysator beschädigen und erhöht die Kosten; bald in die Werkstatt."
    }
  },
  "P2100": {
    "tr": {
      "title": "Gaz Kelebeği Kontrol Motoru Devresi Açık",
      "part": "Gaz kelebeğini açıp kapatan elektrik motoru veya kablo bağlantısı.",
      "symptoms": "Gaz pedalına zayıf tepki veya tepkisizlik, güç kaybı; araç acil moda geçebilir.",
      "risk": "Ani güç kaybı trafikte güvenlik riski oluşturur; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Drosselklappen-Stellmotor – Stromkreis unterbrochen",
      "part": "Der Elektromotor, der die Drosselklappe öffnet und schließt, oder seine Verkabelung.",
      "symptoms": "Träge oder keine Reaktion aufs Gaspedal, Leistungsverlust; Notlaufprogramm möglich.",
      "risk": "Plötzlicher Leistungsverlust ist im Verkehr ein Sicherheitsrisiko; so bald wie möglich in die Werkstatt."
    }
  },
  "P2101": {
    "tr": {
      "title": "Gaz Kelebeği Kontrol Motoru Aralık/Performans Arızası",
      "part": "Gaz kelebeği gövdesi ve onu hareket ettiren motor; kirlenme veya sıkışma da neden olabilir.",
      "symptoms": "Düzensiz rölanti, gecikmeli gaz tepkisi, güç sınırlamalı acil mod.",
      "risk": "Kelebek doğru çalışmazsa araç beklenmedik davranabilir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Drosselklappen-Stellmotor – Funktionsbereich/Leistung",
      "part": "Die Drosselklappe und ihr Stellmotor; auch Verschmutzung oder Klemmen kann die Ursache sein.",
      "symptoms": "Unruhiger Leerlauf, verzögerte Gasannahme, Notlaufprogramm mit begrenzter Leistung.",
      "risk": "Eine fehlerhafte Drosselklappe kann zu unerwartetem Fahrverhalten führen; so bald wie möglich in die Werkstatt."
    }
  },
  "P2102": {
    "tr": {
      "title": "Gaz Kelebeği Kontrol Motoru Devresi Düşük Sinyal",
      "part": "Gaz kelebeği motorunun elektrik devresi: kablo, soket veya motorun kendisi.",
      "symptoms": "Bozuk gaz tepkisi, güç kaybı, acil mod; motor arıza lambası yanar.",
      "risk": "Ani güç kaybı trafikte güvenlik riski oluşturur; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Drosselklappen-Stellmotor – Spannung zu niedrig",
      "part": "Der Stromkreis des Drosselklappenmotors: Kabel, Stecker oder der Motor selbst.",
      "symptoms": "Gestörte Gasannahme, Leistungsverlust, Notlaufprogramm; Motorkontrollleuchte an.",
      "risk": "Plötzlicher Leistungsverlust ist im Verkehr ein Sicherheitsrisiko; so bald wie möglich in die Werkstatt."
    }
  },
  "P2103": {
    "tr": {
      "title": "Gaz Kelebeği Kontrol Motoru Devresi Yüksek Sinyal",
      "part": "Gaz kelebeği motorunun elektrik devresi: kablo, soket veya motorun kendisi.",
      "symptoms": "Bozuk gaz tepkisi, güç kaybı, acil mod; motor arıza lambası yanar.",
      "risk": "Ani güç kaybı trafikte güvenlik riski oluşturur; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Drosselklappen-Stellmotor – Spannung zu hoch",
      "part": "Der Stromkreis des Drosselklappenmotors: Kabel, Stecker oder der Motor selbst.",
      "symptoms": "Gestörte Gasannahme, Leistungsverlust, Notlaufprogramm; Motorkontrollleuchte an.",
      "risk": "Plötzlicher Leistungsverlust ist im Verkehr ein Sicherheitsrisiko; so bald wie möglich in die Werkstatt."
    }
  },
  "P2104": {
    "tr": {
      "title": "Gaz Kelebeği Kontrolü – Zorunlu Rölanti Modu",
      "part": "Motor beyni, gaz kelebeği arızası nedeniyle motoru koruma amaçlı rölantiye kilitledi.",
      "symptoms": "Gaz pedalı çalışmaz, motor yalnızca rölanti devrinde döner; araçla ilerlemek neredeyse imkansızdır.",
      "risk": "Bu bir koruma modudur; altta yatan arıza giderilmeden sürüş yapılamaz, aracı güvenle durdurup servisi arayın."
    },
    "de": {
      "title": "Drosselklappensteuerung – erzwungener Leerlauf",
      "part": "Das Steuergerät hat den Motor wegen eines Drosselklappenfehlers zum Schutz auf Leerlauf begrenzt.",
      "symptoms": "Das Gaspedal reagiert nicht, der Motor läuft nur im Leerlauf; Weiterfahren ist kaum möglich.",
      "risk": "Dies ist ein Schutzmodus; ohne Reparatur ist keine normale Fahrt möglich, sicher anhalten und die Werkstatt rufen."
    }
  },
  "P2107": {
    "tr": {
      "title": "Gaz Kelebeği Kontrol Modülü İşlemci Arızası",
      "part": "Gaz kelebeğini yöneten elektronik kontrol ünitesinin kendi iç işlemcisi.",
      "symptoms": "Motor arıza lambası, güç kaybı veya acil mod; bazen belirti hissedilmez.",
      "risk": "Kontrol ünitesi arızası ani güç kaybına yol açabilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Drosselklappen-Steuermodul – Prozessorfehler",
      "part": "Der interne Prozessor des Steuergeräts, das die Drosselklappe regelt.",
      "symptoms": "Motorkontrollleuchte, Leistungsverlust oder Notlauf; manchmal keine spürbaren Symptome.",
      "risk": "Ein Steuergerätefehler kann zu plötzlichem Leistungsverlust führen; zeitnah in die Werkstatt."
    }
  },
  "P2108": {
    "tr": {
      "title": "Gaz Kelebeği Kontrol Modülü Performans Arızası",
      "part": "Gaz kelebeğini yöneten elektronik kontrol ünitesi doğru çalışmıyor.",
      "symptoms": "Motor arıza lambası, düzensiz gaz tepkisi, güç kaybı veya acil mod.",
      "risk": "Kontrol ünitesi arızası ani güç kaybına yol açabilir; kısa sürede servise gösterilmeli."
    },
    "de": {
      "title": "Drosselklappen-Steuermodul – Funktionsstörung",
      "part": "Das Steuergerät, das die Drosselklappe regelt, arbeitet nicht korrekt.",
      "symptoms": "Motorkontrollleuchte, unregelmäßige Gasannahme, Leistungsverlust oder Notlauf.",
      "risk": "Ein Steuergerätefehler kann zu plötzlichem Leistungsverlust führen; zeitnah in die Werkstatt."
    }
  },
  "P2110": {
    "tr": {
      "title": "Gaz Kelebeği Kontrolü – Zorunlu Devir Sınırlama",
      "part": "Motor beyni, gaz kelebeği arızası nedeniyle motor devrini koruma amaçlı sınırladı.",
      "symptoms": "Motor belirli bir devrin üzerine çıkmaz, hızlanma zayıf, hız sınırlı kalır.",
      "risk": "Koruma modu aktiftir; bu şekilde uzun süre sürülmemeli, en kısa sürede servise gidin."
    },
    "de": {
      "title": "Drosselklappensteuerung – erzwungene Drehzahlbegrenzung",
      "part": "Das Steuergerät begrenzt die Motordrehzahl zum Schutz wegen eines Drosselklappenfehlers.",
      "symptoms": "Der Motor dreht nicht über eine bestimmte Drehzahl, schwache Beschleunigung, begrenzte Geschwindigkeit.",
      "risk": "Der Schutzmodus ist aktiv; nicht lange so weiterfahren, so bald wie möglich in die Werkstatt."
    }
  },
  "P2111": {
    "tr": {
      "title": "Gaz Kelebeği Açık Konumda Sıkıştı",
      "part": "Motora giren havayı ayarlayan gaz kelebeği açık konumda takılı kaldı.",
      "symptoms": "Yüksek rölanti; ayağınızı gazdan çekseniz bile motor devri düşmeyebilir.",
      "risk": "Araç beklenmedik şekilde hızlanabilir, ciddi güvenlik riski; aracı güvenle durdurun ve hemen servise başvurun."
    },
    "de": {
      "title": "Drosselklappe klemmt in offener Stellung",
      "part": "Die Drosselklappe, die die Luftzufuhr zum Motor regelt, ist offen hängen geblieben.",
      "symptoms": "Erhöhter Leerlauf; die Drehzahl fällt eventuell nicht, auch wenn Sie vom Gas gehen.",
      "risk": "Das Fahrzeug kann unerwartet beschleunigen, ernstes Sicherheitsrisiko; sicher anhalten und sofort die Werkstatt kontaktieren."
    }
  },
  "P2112": {
    "tr": {
      "title": "Gaz Kelebeği Kapalı Konumda Sıkıştı",
      "part": "Motora giren havayı ayarlayan gaz kelebeği kapalı konumda takılı kaldı.",
      "symptoms": "Gaza basınca araç hızlanmaz, çok zayıf güç; motor stop edebilir.",
      "risk": "Trafikte hızlanamamak tehlikelidir; aracı sürmeye devam etmeyin, servise başvurun."
    },
    "de": {
      "title": "Drosselklappe klemmt in geschlossener Stellung",
      "part": "Die Drosselklappe, die die Luftzufuhr zum Motor regelt, ist geschlossen hängen geblieben.",
      "symptoms": "Kaum oder keine Beschleunigung beim Gasgeben, sehr wenig Leistung; der Motor kann ausgehen.",
      "risk": "Fehlende Beschleunigung im Verkehr ist gefährlich; nicht weiterfahren, Werkstatt kontaktieren."
    }
  },
  "P2118": {
    "tr": {
      "title": "Gaz Kelebeği Motoru Akım Aralık/Performans Arızası",
      "part": "Gaz kelebeği motorunun çektiği elektrik akımı normal dışı; sıkışan kelebek veya yıpranmış motor neden olabilir.",
      "symptoms": "Düzensiz gaz tepkisi, acil mod, motor arıza lambası.",
      "risk": "Kelebek tamamen arızalanırsa ani güç kaybı yaşanır; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Drosselklappenmotor – Stromaufnahme außerhalb des Bereichs",
      "part": "Die Stromaufnahme des Drosselklappenmotors ist auffällig; Ursache kann eine klemmende Klappe oder ein verschlissener Motor sein.",
      "symptoms": "Unregelmäßige Gasannahme, Notlaufprogramm, Motorkontrollleuchte.",
      "risk": "Fällt die Klappe ganz aus, droht plötzlicher Leistungsverlust; so bald wie möglich in die Werkstatt."
    }
  },
  "P2119": {
    "tr": {
      "title": "Gaz Kelebeği Gövdesi Aralık/Performans Arızası",
      "part": "Gaz kelebeği gövdesi; kelebek istenen konuma tam gitmiyor, çoğu zaman kirlenme veya aşınma nedeniyle.",
      "symptoms": "Düzensiz rölanti, gecikmeli veya dalgalı gaz tepkisi; acil mod olabilir.",
      "risk": "Belirtiler hafif olsa da güvenlikle ilgili bir sistemdir; yakında servise gösterin, çoğu zaman temizlik yeterlidir."
    },
    "de": {
      "title": "Drosselklappengehäuse – Funktionsbereich/Leistung",
      "part": "Das Drosselklappengehäuse; die Klappe erreicht die gewünschte Stellung nicht, oft durch Verschmutzung oder Verschleiß.",
      "symptoms": "Unruhiger Leerlauf, verzögerte oder schwankende Gasannahme; Notlauf möglich.",
      "risk": "Auch bei milden Symptomen ist es ein sicherheitsrelevantes System; bald prüfen lassen, oft genügt eine Reinigung."
    }
  },
  "P2122": {
    "tr": {
      "title": "Gaz Pedalı/Kelebek Konum Sensörü D Düşük Sinyal",
      "part": "Gaz pedalına ne kadar basıldığını ölçen sensör veya kablosu.",
      "symptoms": "Gaz pedalına zayıf tepki veya tepkisizlik, acil mod, sınırlı devir.",
      "risk": "Pedal tepkisi aniden kaybolabilir, güvenlik riski; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Gaspedal-/Drosselklappensensor D – Signal zu niedrig",
      "part": "Der Sensor, der misst, wie weit das Gaspedal gedrückt wird, oder seine Verkabelung.",
      "symptoms": "Schwache oder keine Reaktion aufs Gaspedal, Notlaufprogramm, begrenzte Drehzahl.",
      "risk": "Die Pedalreaktion kann plötzlich ausfallen, Sicherheitsrisiko; so bald wie möglich in die Werkstatt."
    }
  },
  "P2123": {
    "tr": {
      "title": "Gaz Pedalı/Kelebek Konum Sensörü D Yüksek Sinyal",
      "part": "Gaz pedalına ne kadar basıldığını ölçen sensör veya kablosu.",
      "symptoms": "Gaz pedalına zayıf tepki veya tepkisizlik, acil mod, sınırlı devir.",
      "risk": "Pedal tepkisi aniden kaybolabilir, güvenlik riski; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Gaspedal-/Drosselklappensensor D – Signal zu hoch",
      "part": "Der Sensor, der misst, wie weit das Gaspedal gedrückt wird, oder seine Verkabelung.",
      "symptoms": "Schwache oder keine Reaktion aufs Gaspedal, Notlaufprogramm, begrenzte Drehzahl.",
      "risk": "Die Pedalreaktion kann plötzlich ausfallen, Sicherheitsrisiko; so bald wie möglich in die Werkstatt."
    }
  },
  "P2127": {
    "tr": {
      "title": "Gaz Pedalı/Kelebek Konum Sensörü E Düşük Sinyal",
      "part": "Gaz pedalındaki ikinci konum sensörü veya kablosu.",
      "symptoms": "Gaz pedalına zayıf tepki veya tepkisizlik, acil mod, sınırlı devir.",
      "risk": "Pedal tepkisi aniden kaybolabilir, güvenlik riski; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Gaspedal-/Drosselklappensensor E – Signal zu niedrig",
      "part": "Der zweite Positionssensor am Gaspedal oder seine Verkabelung.",
      "symptoms": "Schwache oder keine Reaktion aufs Gaspedal, Notlaufprogramm, begrenzte Drehzahl.",
      "risk": "Die Pedalreaktion kann plötzlich ausfallen, Sicherheitsrisiko; so bald wie möglich in die Werkstatt."
    }
  },
  "P2128": {
    "tr": {
      "title": "Gaz Pedalı/Kelebek Konum Sensörü E Yüksek Sinyal",
      "part": "Gaz pedalındaki ikinci konum sensörü veya kablosu.",
      "symptoms": "Gaz pedalına zayıf tepki veya tepkisizlik, acil mod, sınırlı devir.",
      "risk": "Pedal tepkisi aniden kaybolabilir, güvenlik riski; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Gaspedal-/Drosselklappensensor E – Signal zu hoch",
      "part": "Der zweite Positionssensor am Gaspedal oder seine Verkabelung.",
      "symptoms": "Schwache oder keine Reaktion aufs Gaspedal, Notlaufprogramm, begrenzte Drehzahl.",
      "risk": "Die Pedalreaktion kann plötzlich ausfallen, Sicherheitsrisiko; so bald wie möglich in die Werkstatt."
    }
  },
  "P2135": {
    "tr": {
      "title": "Gaz Kelebeği/Pedal Sensörü A/B Gerilim Uyumsuzluğu",
      "part": "Gaz kelebeği konumunu ölçen iki sensörün sinyalleri birbiriyle uyuşmuyor; sensör veya kablo sorunu.",
      "symptoms": "Ani acil mod, güç kaybı, düzensiz gaz tepkisi; bazen aralıklı ortaya çıkar.",
      "risk": "Gaz kontrolü güvenilmez hale gelebilir, güvenlik riski; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Drosselklappen-/Pedalsensor A/B – Spannungsabweichung",
      "part": "Die Signale der beiden Sensoren für die Drosselklappenstellung stimmen nicht überein; Sensor- oder Kabelproblem.",
      "symptoms": "Plötzlicher Notlauf, Leistungsverlust, unregelmäßige Gasannahme; tritt teils sporadisch auf.",
      "risk": "Die Gassteuerung kann unzuverlässig werden, Sicherheitsrisiko; so bald wie möglich in die Werkstatt."
    }
  },
  "P2138": {
    "tr": {
      "title": "Gaz Kelebeği/Pedal Sensörü D/E Gerilim Uyumsuzluğu",
      "part": "Gaz pedalındaki iki konum sensörünün sinyalleri birbiriyle uyuşmuyor; sensör veya kablo sorunu.",
      "symptoms": "Gaz pedalına tepkisizlik, acil mod, sınırlı güç; bazen aralıklı olur.",
      "risk": "Pedal tepkisi aniden kaybolabilir, güvenlik riski; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Drosselklappen-/Pedalsensor D/E – Spannungsabweichung",
      "part": "Die Signale der beiden Positionssensoren am Gaspedal stimmen nicht überein; Sensor- oder Kabelproblem.",
      "symptoms": "Keine Reaktion aufs Gaspedal, Notlaufprogramm, begrenzte Leistung; teils sporadisch.",
      "risk": "Die Pedalreaktion kann plötzlich ausfallen, Sicherheitsrisiko; so bald wie möglich in die Werkstatt."
    }
  },
  "P2146": {
    "tr": {
      "title": "Enjektör Grubu A Besleme Voltajı Devresi / Açık Devre",
      "part": "Yakıt enjektörlerinin bir grubuna elektrik veren kablo, soket veya devre.",
      "symptoms": "Motor tekleyebilir, güç kaybı olur; motor zor çalışabilir veya hiç çalışmayabilir.",
      "risk": "Motor yolda aniden stop edebilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzventile Gruppe A – Versorgungsspannung unterbrochen",
      "part": "Kabel, Stecker oder Stromkreis, der eine Gruppe der Einspritzdüsen mit Strom versorgt.",
      "symptoms": "Motor ruckelt, Leistungsverlust; Motor springt schlecht oder gar nicht an.",
      "risk": "Der Motor kann während der Fahrt plötzlich ausgehen; so schnell wie möglich in die Werkstatt."
    }
  },
  "P2147": {
    "tr": {
      "title": "Enjektör Grubu A Besleme Voltajı Devresi Düşük",
      "part": "Yakıt enjektörlerinin bir grubuna giden elektrik hattında düşük voltaj; kablo veya bağlantı sorunu.",
      "symptoms": "Tekleme, sarsıntılı çalışma, güç kaybı; motor stop edebilir.",
      "risk": "Motor güvenilmez çalışır ve yolda kalabilirsiniz; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Einspritzventile Gruppe A – Versorgungsspannung zu niedrig",
      "part": "Zu niedrige Spannung in der Stromleitung zu einer Gruppe der Einspritzdüsen; Kabel- oder Steckerproblem.",
      "symptoms": "Ruckeln, unrunder Motorlauf, Leistungsverlust; Motor kann ausgehen.",
      "risk": "Der Motor läuft unzuverlässig, Liegenbleiben möglich; zeitnah in die Werkstatt."
    }
  },
  "P2148": {
    "tr": {
      "title": "Enjektör Grubu A Besleme Voltajı Devresi Yüksek",
      "part": "Yakıt enjektörlerinin bir grubuna giden elektrik hattında yüksek voltaj; kablo veya kısa devre sorunu.",
      "symptoms": "Tekleme, düzensiz çalışma, güç kaybı; motor stop edebilir.",
      "risk": "Enjektörler ve motor beyni zarar görebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Einspritzventile Gruppe A – Versorgungsspannung zu hoch",
      "part": "Zu hohe Spannung in der Stromleitung zu einer Gruppe der Einspritzdüsen; Kabel- oder Kurzschlussproblem.",
      "symptoms": "Ruckeln, unrunder Motorlauf, Leistungsverlust; Motor kann ausgehen.",
      "risk": "Einspritzdüsen und Steuergerät können Schaden nehmen; zeitnah in die Werkstatt."
    }
  },
  "P2149": {
    "tr": {
      "title": "Enjektör Grubu B Besleme Voltajı Devresi / Açık Devre",
      "part": "Yakıt enjektörlerinin ikinci grubuna elektrik veren kablo, soket veya devre.",
      "symptoms": "Motor tekleyebilir, güç kaybı olur; motor zor çalışabilir veya hiç çalışmayabilir.",
      "risk": "Motor yolda aniden stop edebilir; en kısa sürede servise gidilmeli."
    },
    "de": {
      "title": "Einspritzventile Gruppe B – Versorgungsspannung unterbrochen",
      "part": "Kabel, Stecker oder Stromkreis, der die zweite Gruppe der Einspritzdüsen mit Strom versorgt.",
      "symptoms": "Motor ruckelt, Leistungsverlust; Motor springt schlecht oder gar nicht an.",
      "risk": "Der Motor kann während der Fahrt plötzlich ausgehen; so schnell wie möglich in die Werkstatt."
    }
  },
  "P2187": {
    "tr": {
      "title": "Rölantide Fakir Karışım (Bank 1)",
      "part": "Yakıt-hava karışımı rölantide çok az yakıtlı; hava kaçağı, yakıt basıncı veya sensör kaynaklı olabilir.",
      "symptoms": "Düzensiz veya titrek rölanti, zor çalışma, kalkışta zayıflık.",
      "risk": "Yakıt tüketimi artar, motor zamanla zarar görebilir; yakın zamanda servise gösterin."
    },
    "de": {
      "title": "Gemisch im Leerlauf zu mager (Bank 1)",
      "part": "Kraftstoff-Luft-Gemisch hat im Leerlauf zu wenig Kraftstoff; mögliche Ursachen sind Falschluft, Kraftstoffdruck oder Sensoren.",
      "symptoms": "Unruhiger oder zitternder Leerlauf, schlechtes Anspringen, Schwäche beim Anfahren.",
      "risk": "Höherer Verbrauch, auf Dauer möglicher Motorschaden; zeitnah in die Werkstatt."
    }
  },
  "P2188": {
    "tr": {
      "title": "Rölantide Zengin Karışım (Bank 1)",
      "part": "Yakıt-hava karışımı rölantide çok fazla yakıtlı; enjektör, sensör veya basınç kaynaklı olabilir.",
      "symptoms": "Düzensiz rölanti, yakıt kokusu, siyah duman, yüksek tüketim.",
      "risk": "Katalizör ve partikül filtresi zarar görebilir, yakıt maliyeti artar; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Gemisch im Leerlauf zu fett (Bank 1)",
      "part": "Kraftstoff-Luft-Gemisch hat im Leerlauf zu viel Kraftstoff; mögliche Ursachen sind Einspritzdüsen, Sensoren oder Kraftstoffdruck.",
      "symptoms": "Unruhiger Leerlauf, Kraftstoffgeruch, schwarzer Rauch, hoher Verbrauch.",
      "risk": "Katalysator und Partikelfilter können Schaden nehmen, Kraftstoffkosten steigen; zeitnah in die Werkstatt."
    }
  },
  "P2189": {
    "tr": {
      "title": "Rölantide Fakir Karışım (Bank 2)",
      "part": "Motorun ikinci tarafında yakıt-hava karışımı rölantide çok az yakıtlı; hava kaçağı, yakıt basıncı veya sensör kaynaklı olabilir.",
      "symptoms": "Düzensiz veya titrek rölanti, zor çalışma, kalkışta zayıflık.",
      "risk": "Yakıt tüketimi artar, motor zamanla zarar görebilir; yakın zamanda servise gösterin."
    },
    "de": {
      "title": "Gemisch im Leerlauf zu mager (Bank 2)",
      "part": "Auf der zweiten Motorseite hat das Kraftstoff-Luft-Gemisch im Leerlauf zu wenig Kraftstoff; mögliche Ursachen sind Falschluft, Kraftstoffdruck oder Sensoren.",
      "symptoms": "Unruhiger oder zitternder Leerlauf, schlechtes Anspringen, Schwäche beim Anfahren.",
      "risk": "Höherer Verbrauch, auf Dauer möglicher Motorschaden; zeitnah in die Werkstatt."
    }
  },
  "P2190": {
    "tr": {
      "title": "Rölantide Zengin Karışım (Bank 2)",
      "part": "Motorun ikinci tarafında yakıt-hava karışımı rölantide çok fazla yakıtlı; enjektör, sensör veya basınç kaynaklı olabilir.",
      "symptoms": "Düzensiz rölanti, yakıt kokusu, siyah duman, yüksek tüketim.",
      "risk": "Katalizör ve partikül filtresi zarar görebilir, yakıt maliyeti artar; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Gemisch im Leerlauf zu fett (Bank 2)",
      "part": "Auf der zweiten Motorseite hat das Kraftstoff-Luft-Gemisch im Leerlauf zu viel Kraftstoff; mögliche Ursachen sind Einspritzdüsen, Sensoren oder Kraftstoffdruck.",
      "symptoms": "Unruhiger Leerlauf, Kraftstoffgeruch, schwarzer Rauch, hoher Verbrauch.",
      "risk": "Katalysator und Partikelfilter können Schaden nehmen, Kraftstoffkosten steigen; zeitnah in die Werkstatt."
    }
  },
  "P2191": {
    "tr": {
      "title": "Yüksek Yükte Fakir Karışım (Bank 1)",
      "part": "Gaza basıldığında yakıt-hava karışımı çok az yakıtlı kalıyor; yakıt basıncı, pompa veya hava kaçağı kaynaklı olabilir.",
      "symptoms": "Hızlanırken ve yokuşta güç kaybı, tekleme, çekiş zayıflığı.",
      "risk": "Motor yük altında zarar görebilir ve yolda kalabilirsiniz; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Gemisch bei hoher Last zu mager (Bank 1)",
      "part": "Beim Gasgeben bekommt das Kraftstoff-Luft-Gemisch zu wenig Kraftstoff; mögliche Ursachen sind Kraftstoffdruck, Pumpe oder Falschluft.",
      "symptoms": "Leistungsverlust beim Beschleunigen und am Berg, Ruckeln, schwacher Durchzug.",
      "risk": "Motorschaden unter Last möglich, Liegenbleiben droht; zeitnah in die Werkstatt."
    }
  },
  "P2192": {
    "tr": {
      "title": "Yüksek Yükte Zengin Karışım (Bank 1)",
      "part": "Gaza basıldığında yakıt-hava karışımı çok fazla yakıtlı oluyor; enjektör, sensör veya basınç kaynaklı olabilir.",
      "symptoms": "Hızlanırken siyah duman, yüksek yakıt tüketimi, güç düşüklüğü hissedilebilir.",
      "risk": "Katalizör ve partikül filtresi tıkanabilir, yakıt maliyeti artar; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Gemisch bei hoher Last zu fett (Bank 1)",
      "part": "Beim Gasgeben bekommt das Kraftstoff-Luft-Gemisch zu viel Kraftstoff; mögliche Ursachen sind Einspritzdüsen, Sensoren oder Kraftstoffdruck.",
      "symptoms": "Schwarzer Rauch beim Beschleunigen, hoher Verbrauch, spürbar weniger Leistung.",
      "risk": "Katalysator und Partikelfilter können verstopfen, Kraftstoffkosten steigen; zeitnah in die Werkstatt."
    }
  },
  "P2195": {
    "tr": {
      "title": "Oksijen Sensörü Sinyali Fakirde Takılı (Bank 1, Sensör 1)",
      "part": "Egzozdaki oksijen (lambda) sensörü veya karışımı sürekli fakir gösteren bir arıza.",
      "symptoms": "Yüksek yakıt tüketimi, düzensiz rölanti, güç kaybı hissedilebilir.",
      "risk": "Yakıt maliyeti artar ve katalizör zarar görebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Lambdasonde Signal hängt auf mager (Bank 1, Sensor 1)",
      "part": "Die Lambdasonde im Abgasstrang oder eine Störung, die das Gemisch dauerhaft als zu mager meldet.",
      "symptoms": "Hoher Verbrauch, unruhiger Leerlauf, spürbarer Leistungsverlust möglich.",
      "risk": "Kraftstoffkosten steigen, Katalysator kann Schaden nehmen; zeitnah in die Werkstatt."
    }
  },
  "P2196": {
    "tr": {
      "title": "Oksijen Sensörü Sinyali Zenginde Takılı (Bank 1, Sensör 1)",
      "part": "Egzozdaki oksijen (lambda) sensörü veya karışımı sürekli zengin gösteren bir arıza.",
      "symptoms": "Yüksek yakıt tüketimi, siyah duman, düzensiz rölanti görülebilir.",
      "risk": "Katalizör ve partikül filtresi zarar görebilir, yakıt maliyeti artar; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Lambdasonde Signal hängt auf fett (Bank 1, Sensor 1)",
      "part": "Die Lambdasonde im Abgasstrang oder eine Störung, die das Gemisch dauerhaft als zu fett meldet.",
      "symptoms": "Hoher Verbrauch, schwarzer Rauch, unruhiger Leerlauf möglich.",
      "risk": "Katalysator und Partikelfilter können Schaden nehmen, Kraftstoffkosten steigen; zeitnah in die Werkstatt."
    }
  },
  "P2197": {
    "tr": {
      "title": "Oksijen Sensörü Sinyali Fakirde Takılı (Bank 2, Sensör 1)",
      "part": "Motorun ikinci tarafındaki oksijen (lambda) sensörü veya karışımı sürekli fakir gösteren bir arıza.",
      "symptoms": "Yüksek yakıt tüketimi, düzensiz rölanti, güç kaybı hissedilebilir.",
      "risk": "Yakıt maliyeti artar ve katalizör zarar görebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Lambdasonde Signal hängt auf mager (Bank 2, Sensor 1)",
      "part": "Die Lambdasonde auf der zweiten Motorseite oder eine Störung, die das Gemisch dauerhaft als zu mager meldet.",
      "symptoms": "Hoher Verbrauch, unruhiger Leerlauf, spürbarer Leistungsverlust möglich.",
      "risk": "Kraftstoffkosten steigen, Katalysator kann Schaden nehmen; zeitnah in die Werkstatt."
    }
  },
  "P2198": {
    "tr": {
      "title": "Oksijen Sensörü Sinyali Zenginde Takılı (Bank 2, Sensör 1)",
      "part": "Motorun ikinci tarafındaki oksijen (lambda) sensörü veya karışımı sürekli zengin gösteren bir arıza.",
      "symptoms": "Yüksek yakıt tüketimi, siyah duman, düzensiz rölanti görülebilir.",
      "risk": "Katalizör ve partikül filtresi zarar görebilir, yakıt maliyeti artar; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Lambdasonde Signal hängt auf fett (Bank 2, Sensor 1)",
      "part": "Die Lambdasonde auf der zweiten Motorseite oder eine Störung, die das Gemisch dauerhaft als zu fett meldet.",
      "symptoms": "Hoher Verbrauch, schwarzer Rauch, unruhiger Leerlauf möglich.",
      "risk": "Katalysator und Partikelfilter können Schaden nehmen, Kraftstoffkosten steigen; zeitnah in die Werkstatt."
    }
  },
  "P2263": {
    "tr": {
      "title": "Turbo Basınç Sistemi Performans Arızası",
      "part": "Turbo sistemi: turbo ünitesi, basınç sensörü, hortumlar veya ayar mekanizması beklenen basıncı sağlamıyor.",
      "symptoms": "Belirgin güç kaybı, özellikle yokuşta ve yüklüyken; araç acil (emniyet) moduna geçebilir.",
      "risk": "Turbo tamamen arızalanabilir ve pahalı motor hasarı oluşabilir; kısa sürede servise gidin."
    },
    "de": {
      "title": "Turbolader Ladedrucksystem – Leistung fehlerhaft",
      "part": "Das Turbosystem: Turbolader, Ladedrucksensor, Schläuche oder Verstellmechanik liefern nicht den erwarteten Druck.",
      "symptoms": "Deutlicher Leistungsverlust, besonders am Berg und mit Beladung; Fahrzeug kann ins Notlaufprogramm gehen.",
      "risk": "Der Turbolader kann komplett ausfallen, teurer Motorschaden möglich; zeitnah in die Werkstatt."
    }
  },
  "P2279": {
    "tr": {
      "title": "Emme Havası Sisteminde Kaçak",
      "part": "Hava filtresinden motora giden hava yolunda (hortum, conta, boru) kaçak var.",
      "symptoms": "Düzensiz rölanti, güç kaybı, motor bölgesinden ıslık sesi duyulabilir.",
      "risk": "Yakıt tüketimi artar ve motor düzensiz çalışır; uygun bir zamanda servise gösterin."
    },
    "de": {
      "title": "Undichtigkeit im Ansaugluftsystem",
      "part": "Leck im Luftweg vom Luftfilter zum Motor (Schlauch, Dichtung, Rohr).",
      "symptoms": "Unruhiger Leerlauf, Leistungsverlust, eventuell Pfeifgeräusch aus dem Motorraum.",
      "risk": "Höherer Verbrauch und unrunder Motorlauf; bei Gelegenheit in die Werkstatt."
    }
  },
  "P2452": {
    "tr": {
      "title": "Dizel Partikül Filtresi (DPF) Basınç Sensörü A Devre Arızası",
      "part": "Partikül filtresinin doluluğunu ölçen basınç sensörü veya kablosu.",
      "symptoms": "Genelde sadece arıza lambası yanar; bazen güç kaybı veya artan tüketim olabilir.",
      "risk": "Filtrenin doluluğu ölçülemez, DPF fark edilmeden tıkanabilir ve pahalı hasar oluşur; kısa sürede servise gidin."
    },
    "de": {
      "title": "Dieselpartikelfilter Differenzdrucksensor A – Stromkreisfehler",
      "part": "Der Drucksensor, der die Beladung des Partikelfilters misst, oder dessen Verkabelung.",
      "symptoms": "Meist nur die Motorkontrollleuchte; manchmal Leistungsverlust oder höherer Verbrauch.",
      "risk": "Die Filterbeladung wird nicht mehr gemessen, der DPF kann unbemerkt verstopfen und teuren Schaden verursachen; zeitnah in die Werkstatt."
    }
  },
  "P2453": {
    "tr": {
      "title": "DPF Basınç Sensörü A Sinyal Aralığı/Performans Arızası",
      "part": "Partikül filtresinin basınç sensörü mantıksız veya tutarsız değerler gönderiyor; sensör veya hortumları sorunlu olabilir.",
      "symptoms": "Arıza lambası yanar; sık rejenerasyon, artan tüketim veya güç kaybı görülebilir.",
      "risk": "Filtre yanlış yönetilir ve tıkanabilir, pahalı DPF hasarı riski var; kısa sürede servise gidin."
    },
    "de": {
      "title": "DPF Differenzdrucksensor A – Signal unplausibel",
      "part": "Der Drucksensor des Partikelfilters liefert unplausible oder schwankende Werte; Sensor oder seine Schläuche können defekt sein.",
      "symptoms": "Motorkontrollleuchte an; häufige Regeneration, höherer Verbrauch oder Leistungsverlust möglich.",
      "risk": "Der Filter wird falsch gesteuert und kann verstopfen, teurer DPF-Schaden droht; zeitnah in die Werkstatt."
    }
  },
  "P2454": {
    "tr": {
      "title": "DPF Basınç Sensörü A Devresi Düşük Sinyal",
      "part": "Partikül filtresi basınç sensöründen gelen sinyal çok düşük; sensör, kablo veya bağlantı sorunu.",
      "symptoms": "Genelde sadece arıza lambası yanar; bazen artan tüketim veya güç kaybı olabilir.",
      "risk": "Filtre doluluğu doğru izlenemez ve DPF tıkanabilir; kısa sürede servise gidin."
    },
    "de": {
      "title": "DPF Differenzdrucksensor A – Signal zu niedrig",
      "part": "Das Signal vom Drucksensor des Partikelfilters ist zu niedrig; Sensor-, Kabel- oder Steckerproblem.",
      "symptoms": "Meist nur die Motorkontrollleuchte; manchmal höherer Verbrauch oder Leistungsverlust.",
      "risk": "Die Filterbeladung wird nicht korrekt überwacht, der DPF kann verstopfen; zeitnah in die Werkstatt."
    }
  },
  "P2455": {
    "tr": {
      "title": "DPF Basınç Sensörü A Devresi Yüksek Sinyal",
      "part": "Partikül filtresi basınç sensöründen gelen sinyal çok yüksek; sensör, kablo sorunu veya gerçekten tıkanan filtre.",
      "symptoms": "Arıza lambası yanar; güç kaybı ve artan tüketim görülebilir.",
      "risk": "Filtre tıkanmış olabilir veya yanlış izleniyor olabilir, pahalı hasar riski var; kısa sürede servise gidin."
    },
    "de": {
      "title": "DPF Differenzdrucksensor A – Signal zu hoch",
      "part": "Das Signal vom Drucksensor des Partikelfilters ist zu hoch; Sensor- oder Kabelproblem oder tatsächlich verstopfter Filter.",
      "symptoms": "Motorkontrollleuchte an; Leistungsverlust und höherer Verbrauch möglich.",
      "risk": "Der Filter kann verstopft sein oder wird falsch überwacht, teurer Schaden droht; zeitnah in die Werkstatt."
    }
  },
  "P2458": {
    "tr": {
      "title": "DPF Rejenerasyon Süresi Arızası",
      "part": "Partikül filtresinin kendini temizleme (yakma) işlemi beklenenden uzun sürüyor veya tamamlanamıyor.",
      "symptoms": "Artan yakıt tüketimi, güç düşüklüğü; egzozdan farklı koku gelebilir.",
      "risk": "Filtre tam temizlenemez ve tıkanabilir, motor yağı seyrelip motora zarar verebilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "DPF Regeneration – Dauer fehlerhaft",
      "part": "Die Selbstreinigung (Freibrennen) des Partikelfilters dauert länger als vorgesehen oder wird nicht abgeschlossen.",
      "symptoms": "Höherer Verbrauch, weniger Leistung; eventuell ungewohnter Geruch aus dem Auspuff.",
      "risk": "Der Filter wird nicht richtig gereinigt und kann verstopfen, Motoröl kann sich verdünnen und den Motor schädigen; zeitnah in die Werkstatt."
    }
  },
  "P2459": {
    "tr": {
      "title": "DPF Rejenerasyon Sıklığı Arızası",
      "part": "Partikül filtresi kendini çok sık temizlemeye çalışıyor; filtre hızlı doluyor veya bir sensör yanlış ölçüyor.",
      "symptoms": "Belirgin şekilde artan yakıt tüketimi; sık sık yüksek rölanti ve fan sesi fark edilebilir.",
      "risk": "Filtre kalıcı olarak tıkanabilir ve değişimi pahalıdır; kısa mesafeli sürüşlerden kaçının ve servise gösterin."
    },
    "de": {
      "title": "DPF Regeneration – Häufigkeit fehlerhaft",
      "part": "Der Partikelfilter versucht sich zu oft zu reinigen; er füllt sich zu schnell oder ein Sensor misst falsch.",
      "symptoms": "Deutlich höherer Verbrauch; häufig erhöhte Leerlaufdrehzahl und Lüftergeräusch spürbar.",
      "risk": "Der Filter kann dauerhaft verstopfen, der Austausch ist teuer; Kurzstrecken vermeiden und in die Werkstatt."
    }
  },
  "P2463": {
    "tr": {
      "title": "DPF Tıkanıklığı – Kurum Birikimi",
      "part": "Dizel partikül filtresi kurumla dolmuş ve tıkanmış durumda.",
      "symptoms": "Güç kaybı, araç acil (emniyet) moduna geçebilir, artan yakıt tüketimi.",
      "risk": "Filtre tamamen tıkanırsa pahalı değişim gerekebilir ve motor zarar görebilir; aracı zorlamayın, hemen servise gidin."
    },
    "de": {
      "title": "Dieselpartikelfilter verstopft – Rußansammlung",
      "part": "Der Dieselpartikelfilter ist mit Ruß überladen und verstopft.",
      "symptoms": "Leistungsverlust, Fahrzeug kann ins Notlaufprogramm gehen, höherer Verbrauch.",
      "risk": "Bei kompletter Verstopfung droht ein teurer Austausch und Motorschaden; Fahrzeug schonen und sofort in die Werkstatt."
    }
  },
  "U0100": {
    "tr": {
      "title": "Motor Kontrol Ünitesi (ECM/PCM) ile İletişim Kesildi",
      "part": "Motor beyni ile aracın diğer bilgisayarları arasındaki veri hattı (CAN) bağlantısı.",
      "symptoms": "Motor çalışmayabilir veya aniden stop edebilir; göstergede birçok uyarı lambası yanabilir.",
      "risk": "Araç yolda kalabilir ve davranışı öngörülemez; sürüşe devam etmeyin, hemen servise başvurun."
    },
    "de": {
      "title": "Kommunikation mit Motorsteuergerät (ECM/PCM) verloren",
      "part": "Die Datenverbindung (CAN-Bus) zwischen dem Motorsteuergerät und den anderen Steuergeräten des Fahrzeugs.",
      "symptoms": "Motor springt eventuell nicht an oder geht plötzlich aus; viele Warnleuchten können aufleuchten.",
      "risk": "Liegenbleiben möglich, Fahrzeugverhalten unvorhersehbar; nicht weiterfahren, sofort die Werkstatt kontaktieren."
    }
  },
  "U0101": {
    "tr": {
      "title": "Şanzıman Kontrol Ünitesi (TCM) ile İletişim Kesildi",
      "part": "Otomatik şanzıman beyni ile aracın veri hattı (CAN) arasındaki bağlantı.",
      "symptoms": "Vites geçişlerinde sorun, şanzıman acil modda tek viteste kalabilir, vites uyarı lambası yanabilir.",
      "risk": "Araç güvenli sürülemeyebilir ve şanzıman zarar görebilir; en kısa sürede servise gidin."
    },
    "de": {
      "title": "Kommunikation mit Getriebesteuergerät (TCM) verloren",
      "part": "Die Verbindung zwischen dem Steuergerät des Automatikgetriebes und dem Datennetz (CAN-Bus) des Fahrzeugs.",
      "symptoms": "Schaltprobleme, das Getriebe kann im Notlauf in einem Gang bleiben, Getriebewarnleuchte möglich.",
      "risk": "Sicheres Fahren ist eventuell nicht möglich, Getriebeschaden droht; so schnell wie möglich in die Werkstatt."
    }
  },
  "U0121": {
    "tr": {
      "title": "ABS Kontrol Ünitesi ile İletişim Kesildi",
      "part": "Fren güvenlik sistemi (ABS) beyni ile aracın veri hattı (CAN) arasındaki bağlantı.",
      "symptoms": "ABS ve ESP uyarı lambaları yanar; fren yardım sistemleri devre dışı kalabilir.",
      "risk": "Ani frenlemede tekerlekler kilitlenebilir, kaza riski artar; dikkatli sürün ve en kısa sürede servise gidin."
    },
    "de": {
      "title": "Kommunikation mit ABS-Steuergerät verloren",
      "part": "Die Verbindung zwischen dem Steuergerät des Bremssicherheitssystems (ABS) und dem Datennetz (CAN-Bus) des Fahrzeugs.",
      "symptoms": "ABS- und ESP-Warnleuchten leuchten; die Bremsassistenzsysteme können ausfallen.",
      "risk": "Bei einer Vollbremsung können die Räder blockieren, erhöhte Unfallgefahr; vorsichtig fahren und schnellstmöglich in die Werkstatt."
    }
  },
  "U0140": {
    "tr": {
      "title": "Karoser Kontrol Ünitesi (BCM) ile İletişim Kesildi",
      "part": "Farlar, silecekler, merkezi kilit gibi donanımları yöneten karoser beyni ile veri hattı (CAN) bağlantısı.",
      "symptoms": "Farlar, sinyaller, silecekler, camlar veya merkezi kilit düzensiz çalışabilir; çeşitli uyarılar yanabilir.",
      "risk": "Aydınlatma ve silecek gibi güvenlik donanımları devre dışı kalabilir; kısa sürede servise gösterin."
    },
    "de": {
      "title": "Kommunikation mit Karosseriesteuergerät (BCM) verloren",
      "part": "Die Verbindung zum Karosseriesteuergerät, das Licht, Scheibenwischer, Zentralverriegelung und ähnliche Funktionen steuert.",
      "symptoms": "Licht, Blinker, Scheibenwischer, Fenster oder Zentralverriegelung können unzuverlässig funktionieren; verschiedene Warnungen möglich.",
      "risk": "Sicherheitsrelevante Funktionen wie Licht und Wischer können ausfallen; zeitnah in die Werkstatt."
    }
  },
  "U0155": {
    "tr": {
      "title": "Gösterge Paneli Kontrol Ünitesi ile İletişim Kesildi",
      "part": "Hız, devir ve uyarı lambalarını gösteren gösterge paneli ile aracın veri hattı (CAN) arasındaki bağlantı.",
      "symptoms": "Göstergeler donabilir, sıfırda kalabilir veya düzensiz çalışabilir; uyarı lambaları güvenilmez olur.",
      "risk": "Hızınızı ve önemli uyarıları göremezsiniz, bu güvenlik riski oluşturur; kısa sürede servise gidin."
    },
    "de": {
      "title": "Kommunikation mit Kombiinstrument verloren",
      "part": "Die Verbindung zwischen dem Kombiinstrument (Tacho, Drehzahl, Warnleuchten) und dem Datennetz (CAN-Bus) des Fahrzeugs.",
      "symptoms": "Anzeigen können einfrieren, auf null stehen oder unregelmäßig arbeiten; Warnleuchten sind nicht mehr zuverlässig.",
      "risk": "Geschwindigkeit und wichtige Warnungen sind nicht sichtbar, das ist ein Sicherheitsrisiko; zeitnah in die Werkstatt."
    }
  }
};

/** Kodun yerelleştirilmiş açıklaması, sözlükte yoksa null (→ UI fallback metni). */
export function lookupDtc(code: string, locale: string): DtcText | null {
  const info = DTC_CODES[code.trim().toUpperCase()];
  if (!info) return null;
  return locale === "de" ? info.de : info.tr;
}
