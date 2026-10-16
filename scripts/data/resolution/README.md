# People resolution, phase 1 (data only)

Output of `python scripts/resolve_people.py --sample`. Nothing here is applied to the app: it is a
layer of *persons* over the name keys, plus proposals for the community to accept or reject.

- `persons.json` — one entry per person: stable `id`, the name `key` it came from, display `name`
  (most frequent spelling), `variants`, `records`, `span`, `born` = [year, evidence ids, established]
  (established = two stated ages agree; a single "de N años" is often someone else's age in the deed),
  `dead_by`, `spouse`/`parents`/`children`/`siblings`/`residence` with evidence ids, `titles`,
  `split_from` (how many persons the key became). `unresolvable: "given name only"` marks keys like
  *maría* or *juan francisco* that no amount of arithmetic can separate.
- `proposals.jsonl` — `split` proposals (one per key that became several persons, with the lives and
  the conflicts that separated them) and `merge` proposals between persons of different keys:
  `kind: spelling` (identical once particles, abbreviations and titles are normalized) or `similar`
  (Jaro-Winkler ≥ 0.82 or a subset name), with `confidence` and `reasons`.
- `scorecard.json` — before/after metrics.

## Scorecard

- name_keys: 20341
- persons: 21394
- keys_split: 913
- persons_from_splits: 1966
- unresolvable_given_name_keys: 1412
- records_in_unresolvable_keys: 7164
- keys_span_over_85y_before: 1079
- persons_span_over_85y_after: 0
- split_conflicts: {'death': 629, 'lifespan': 5007, 'clergy': 24, 'birth': 7}
- splits_with_arbitrary_boundary: 132
- birth_hints_in_people_json: 230
- birth_hints_trusted: 233
- dead_hints_in_people_json: 2555
- dead_hints_trusted: 2575
- merge_proposals: 7192
- merge_proposals_spelling: 1972
- merge_proposals_sure: 2000
- single_record_keys_before: 12376
- single_record_persons_after_split: 13018
- single_record_persons_after_sure_merges: 11519

## What the scorecard says

- `build_people.py` now anchors ages, deaths, spouses and parents to the person's own name (the first version attached any "de N años" or "difunto" in the sentence to everyone in it, so a seller was "born" from the age of the slave he sold). people.json went from 3 070 to 230 birth hints, 8 278 to 2 555 death mentions, 14 621 to 11 996 spouse links; what remains is attributable.
- Lifespan is the dominant split reason: 5 000+ mentions could not belong to the life they followed. Where that is the *only* reason and the lives touch, the boundary is marked `arbitrary`: the key holds a father and a son (or three generations) and only a reader or a model with the summaries can place the cut.
- `spelling` merges (same name once particles, abbreviations and titles are normalized, lives compatible) are safe to accept in bulk; `similar` ones at 0.5–0.75 are subset names with compatible years and need a reader.
- Given-name-only keys (*maría*, *juan francisco*) hold 7 164 record mentions and are left whole and flagged.

## Sample (10 largest splits, 10 random; 10 surest merges, 10 random under 0.75)

```
=== SPLITS (10 largest, 10 random) ===

pedro de alvarado  (842 records → 6 persons; conflicts {'lifespan': 193, 'death': 24, 'clergy': 5}; boundary evidence)
  - Pb7c07a35 Pedro de Alvarado  [1520, 1570]  n=733  {'military': 450, 'don': 1}
      #200006: En el mismo día de la fundación, Pedro de Alvarado, teniente gobernador y capitán general en nombre de Hernán Cortés, nombra los primeros of
  - Pb8340fcd Pedro de Alvarado  [1615, 1700]  n=42  {'don': 20, 'military': 2}
      #2014: El Alcalde Alonso de Bonilla concertó un aprendizaje para Diego de Sojo, hijo de Alonso de Sojo y Ana de Arrieta, con Pedro de Alvarado, un 
  - P0a725a76 Don Pedro de Alvarado  [1701, 1749]  n=41  cónyuge: catalina de vida martel, catarina de vida martel  {'don': 20, 'military': 4}
      #2427: Antonio de Acosta Arévalo vendió una plantación de cacao de 2000 árboles ubicada en la orilla del río Matina, en la costa del Mar del Norte,
  - Pdcf34070 Pedro de Alvarado  [1751, 1788]  n=11  cónyuge: estaba  {'don': 4}
      #6729: Felipe de Umaña y su esposa María Francisca Fernández se comprometieron a pagar $200 en cacao con un interés del 5% a Bernabé de Ugalde, el 
  - P8a6e7824 Don Pedro de Alvarado  [1792, 1819]  n=12  {'don': 6, 'clergy': 4}
      #3241: Don Pedro Ortiz de Rosas proporcionó una dote de $5375 y arras de $2000 para su futura esposa, Doña Juana de Alvarado Vera y Sotomayor, hija
  - Pf1308663 Don Pedro de Alvarado  [1800, 1807]  n=3  cónyuge: manuela baeza, maria manuela baeza  {'don': 3}
      #9838: Doña María Manuela Baeza, viuda de don Pedro de Alvarado, hizo su testamento, enumerando a sus hijos vivos (don Juan Manuel, Beneficiado don

jorge de alvarado  (236 records → 4 persons; conflicts {'lifespan': 69}; boundary arbitrary)
  - P99ae5f7e Jorge de Alvarado (teniente de gobernador)  [1520, 1541]  n=186  {'military': 169}
      #200021: Continuación del acta de elección anual de oficios: Pedro de Alvarado, en nombre de Su Majestad y del gobernador, nombra alcaldes ordinarios
  - Pc1240e47 Jorge de Alvarado  [1623, 1705]  n=35  cónyuge: gertrudis de echavarria navarro  {'don': 20, 'military': 2}
      #2105: Se emitió una carta de dote para Jorge de Alvarado, hijo de Gil de Alvarado y Juana de Vera, y su esposa Gertrudis de Sandoval, hija de Juan
  - P6e1ee2ce Jorge de Alvarado  [1709, 1727]  n=11  cónyuge: gertrudis de chavarria navarro, gertrudis de sandoval  {'don': 2, 'military': 2}
      #3445: Don Pedro de Alvarado, hijo del difunto Alférez Gil de Alvarado y Juana de Vera y Sotomayor, hizo su testamento. Estaba casado con Catalina 
  - Pf2b58801 Don Jorge de Alvarado  [1798, 1798]  n=4  {'don': 3}
      #3261: Los Capitanes Don Matías González Camino, Don José Pérez de Muro, Diego de San Martín y Soto, y Don Jorge de Alvarado actuaron como fiadores

antonio de la fuente  (166 records → 2 persons; conflicts {'lifespan': 7}; boundary arbitrary)
  - Pa4a2f6a8 Don Antonio de la Fuente  [1721, 1804]  n=159  cónyuge: maria francisca de alvarado  {'don': 108, 'military': 3}
      #7621: Se emitió una carta de dote por Don Antonio de la Fuente, natural de Astorga en los reinos de Castilla, hijo de Don Ignacio de la Fuente y D
  - P51da9b14 Don Antonio de la Fuente  [1807, 1831]  n=7  cónyuge: maria francisca alvarado  {'don': 4, 'military': 1}
      #7917: Don Antonio de la Fuente, actuando como apoderado de Don Juan Garau de Cort, vendió a la mujer esclavizada de 27 años, María Ramona Guerrero

juan de echavarria navarro  (138 records → 2 persons; conflicts {'death': 36, 'lifespan': 14}; boundary evidence)
  - P0680f4e8 Juan de Echavarría Navarro  [1615, 1666]  n=88  cónyuge: maria de sandoval, maria de sandoval ocampo  {'military': 5, 'don': 21}
      #164: Luisa Hernández, viuda de Capitán Juan de Lamas, recibió 200 pesos de Padre Baltasar de Grado con una tasa de interés anual del 5%. Hipotecó
  - Pb1e8402a Juan de Echavarría Navarro  [1668, 1719]  n=50  cónyuge: ana, ana de retes, antonia maria de otalora  {'don': 8, 'military': 10}
      #1238: El Sargento Mayor José de Moya y su esposa, Doña Mayor de Benavides Moreno, se comprometieron a pagar $150 con un interés anual del 5% a los

miguel calvo  (133 records → 3 persons; conflicts {'lifespan': 99}; boundary arbitrary)
  - P236188c4 Miguel Calvo  [1608, 1693]  n=36  {'military': 11}
      #59: Miguel Calvo vendió a un hombre negro esclavizado llamado Juan, de Angola, a Gaspar Pereira Cardoso, Alguacil Mayor de la Gobernación, por 3
  - Pead44041 Capitán don Miguel Calvo  [1694, 1773]  n=95  {'military': 54, 'don': 4}
      #2619: El Capitán Juan Rodríguez Plaza y su esposa Juana de Salazar se obligaron por $300 a una Capellanía fundada por el Capitán Matías González C
  - P2ef8243b Capitán don Miguel Calvo  [1798, 1798]  n=2  {'military': 2}
      #3243: El Capitán Antonio de Rojas Miranda, como principal, y el Alférez Diego de Cárdenas, como garante, se comprometieron con el Capitán don Migu

gil de alvarado  (129 records → 2 persons; conflicts {'lifespan': 48}; boundary arbitrary)
  - Pbee604d2 Gil de Alvarado  [1629, 1712]  n=81  cónyuge: antonio, ines de sandoval ocampo golfin  {'don': 32, 'military': 16}
      #106: Andrés Morillo se obligó con el Capitán General Juan de Echauz, Gobernador de la provincia, por 200 pesos. Este dinero fue prestado para can
  - P28249ee9 Gil de Alvarado  [1715, 1756]  n=48  cónyuge: estaba, ines de sandoval golfin, manuela petronila lopez  {'don': 21, 'military': 12}
      #4037: Don Gil de Alvarado y su esposa, doña Josefa González Camino, vendieron una parte de una casa de adobe con tejas, que le fue dada como dote,

antonio de salazar  (125 records → 3 persons; conflicts {'lifespan': 3}; boundary evidence)
  - Pb5eca8da Antonio de Salazar (regidor)  [1527, 1530]  n=123  
      #200084: Antonio de Salazar declara que el asiento del Tianguecillo es bueno, con aguas, salidas y aspecto sano, pero cree que faltará yerba para cab
  - Pd418b063 Antonio de Salazar  [1617, 1617]  n=1  
      #100258: Conclusión de una sesión en la que se debate sobre la nulidad de un acuerdo por falta de cabildo pleno y se anota que no hubo apelación. Fir
  - P38a66893 Antonio de Salazar  [1709, 1709]  n=1  
      #3888: El Sargento Mayor Francisco de Ocampo Golfín, Alcalde Ordinario Mayor, concertó un aprendizaje de cinco años para Antonio de Salazar, un niñ

tomas lopez del corral  (125 records → 3 persons; conflicts {'death': 75, 'lifespan': 54}; boundary evidence)
  - P8557c176 don Tomás López del Corral  [1673, 1673]  n=3  {'don': 3}
      #8004: Don Tomás López del Corral y Pedro Manuel Salguero otorgaron una fianza para Don Juan Fernández de Bobadilla y Grandi, quien fue nombrado Go
  - P6d594a8a Capitán don Tomás López del Corral  [1718, 1790]  n=115  {'don': 39, 'military': 53}
      #5235: El Capitán don Tomás López del Corral, Teniente de Oficiales de la Real Hacienda, canceló la obligación el 20 de septiembre de 1730.
  - Pf0767f40 Don Tomás López del Corral  [1792, 1808]  n=7  {'don': 4}
      #7722: Don Tomás López del Corral y Doña Rosa de la Madriz se obligaron por 820 pesos plata para dos capellanías: 720 pesos para una fundada por Ba

tomas calvo  (121 records → 4 persons; conflicts {'lifespan': 130, 'death': 4}; boundary evidence)
  - P48c23575 Tomás Calvo  [1540, 1625]  n=10  {'military': 2}
      #216: Andrés de Miranda, hijo legítimo de Martín de Miranda e Inés Hidalgo, residentes de León, entregó un recibo de dote (falta una página). Entr
  - P84b4428b Tomás Calvo  [1626, 1711]  n=92  cónyuge: eugenia de abarca  {'military': 23}
      #543: El Alférez Tomás Calvo emitió una carta de dote para su esposa, Eugenia Abarca, hija del Alférez Gaspar Abarca de Latras y Magdalena de Chav
  - Pe1ef2fd7 Tomás Calvo  [1715, 1751]  n=15  cónyuge: victoria lascares  {'don': 1, 'military': 3}
      #4073: Doña Magdalena Calvo, hija de los difuntos Tomás Calvo y Doña Eugenia de Abarca Alatras y viuda del Capitán Francisco Fernández de Miranda, 
  - P7b78afbd Tomás Calvo  [1763, 1786]  n=4  {'military': 1}
      #6837: El 28 de octubre de 1770, Beneficiado don Juan Manuel del Corral, el cura párroco de Heredia, recibió la fragua de Gregorio Calvo, heredero 

francisco de ocampo golfin  (113 records → 3 persons; conflicts {'death': 18, 'lifespan': 71}; boundary evidence)
  - P915a4bec Francisco de Ocampo Golfín  [1607, 1640]  n=29  {'military': 8, 'don': 2}
      #1: El Capitán Francisco de Ocampo Golfín, encomendero de Cartago, otorgó poder general a Gómez Arias. Gómez Arias era procurador legal en la Au
  - Pfa8be13e Francisco de Ocampo Golfín  [1675, 1754]  n=79  {'don': 7, 'military': 8}
      #1522: Alonso de Mora y Leonor de Rivera se obligaron con la Capellanía fundada por Vasco Solano por $1,000, hipotecando el rancho San Bartolomé. E
  - P870a6620 Don Francisco de Ocampo Golfín  [1770, 1800]  n=5  {'military': 1, 'don': 2}
      #3264: El Capitán Francisco de Bonilla, el Alférez Nicolás de Céspedes, el Capitán Francisco de Ocampo Golfín, el Capitán Don Miguel Calvo y el Alf

juan calvo  (18 records → 2 persons; conflicts {'lifespan': 6}; boundary evidence)
  - P86e61bca Juan Calvo  [1658, 1738]  n=12  {'military': 2}
      #1866: El Capitán Juan de Salamanca y Alarcón, residente de Cartago, otorgó poder a don José de Alvarado y Juan Martínez de Ahumada, quienes partía
  - P035bd91a Juan Calvo  [1754, 1809]  n=6  
      #7209: El Presbítero Bachiller José Manuel García de Argueta se obligó por 200 pesos a una capellanía fundada por Luisa Calvo, de la cual él es el 

isidora zambrano  (16 records → 2 persons; conflicts {'lifespan': 14}; boundary evidence)
  - Pb982d106 Isidora Zambrano  [1540, 1540]  n=2  
      #1309: El Capitán Rodrigo Calderón y su esposa Isidora Zambrano se obligaron por $100 a un censo del 5% al fondo de dotes para doncellas de la Cofr
  - Pfb9d36ac Isidora Zambrano  [1630, 1710]  n=14  cónyuge: manuel martinez, rodrigo calderon  {'don': 3}
      #630: Se emite una carta de dote para Manuel Martínez, natural de Valencia, Castilla la Vieja, a favor de su esposa Isidora Zambrano. La dote, val

petronila de quiros  (13 records → 2 persons; conflicts {'lifespan': 2}; boundary evidence)
  - P813d514f Doña Petronila de Quirós  [1682, 1747]  n=11  cónyuge: manuel de sandoval  {'don': 7}
      #2366: Francisco de Quirós, hijo legítimo del difunto Capitán García de Quirós y Juana de Chinchilla, hizo su testamento. Estaba casado con doña Ma
  - P8a64aa25 Petronila de Quirós  [1786, 1795]  n=2  cónyuge: epifania segura  
      #8465: Gregorio Brenes, hijo de Gregorio Brenes y Petronila de Quirós, hizo su última voluntad y testamento. Estaba casado con Efigenia Falcon, con

jose manuel sancho de castaneda  (34 records → 2 persons; conflicts {'lifespan': 14}; boundary arbitrary)
  - Pfea3fe9f José Manuel Sancho de Castañeda  [1673, 1758]  n=20  {'don': 6, 'military': 4}
      #5957: Doña Juana de Alvarado, viuda del Capitán don Juan Sancho de Castañeda, se obligó con sus tres hijos menores (Doña Juana Eufrasia, José Manu
  - Pd72306cf José Manuel Sancho de Castañeda  [1761, 1808]  n=14  {'military': 5, 'don': 4}
      #7309: Capitán don José y su esposa doña Juana Galarza contraen una obligación por 250 pesos plata con un interés del 5%, hipotecando un rancho de 

felipe monge  (9 records → 3 persons; conflicts {'lifespan': 8}; boundary evidence)
  - P7e21c2f6 Felipe Monge  [1540, 1540]  n=2  
      #1305: Tras la muerte de Ana Merino, el Alcalde reasignó a un niño mestizo llamado Juan, que había estado bajo el cuidado de Merino, a Felipe Monge
  - Pec0a9f0d Felipe Monge  [1629, 1714]  n=6  
      #95: Francisca López, viuda del Alférez Felipe Monge, hizo su testamento en Cartago. Declaró deudas al Doctor Diego de Chavarría por misas dichas
  - P44fa27c9 Felipe Monge  [1740, 1740]  n=1  
      #6533: El Capitán Cayetano de Herrera solicitó la agregación de documentos para formalizar su compra de tierras al Sargento Felipe Monge, que inclu

juan de penaranda  (5 records → 2 persons; conflicts {'death': 1}; boundary evidence)
  - Pe00d07c0 Juan de Peñaranda  [1629, 1649]  n=4  
      #118: Doña Fabiana de Sojo y Peñaranda, residente de Cartago y natural de Talamanca (Arzobispado de Toledo, España), hizo su testamento. Se identi
  - Pa3776cf9 Juan de Peñaranda  [1679, 1679]  n=1  
      #2245: Francisca de Peñaranda, hija natural de Juan de Peñaranda, hizo su testamento. Cristóbal López fue nombrado su albacea, y Sofía de Flores fu

juan de guevara  (13 records → 2 persons; conflicts {'lifespan': 4}; boundary evidence)
  - Pc98a8ecf Juan de Guevara (escribano del cabildo)  [1590, 1622]  n=9  {'don': 2}
      #100295: Nombramiento de fiel ejecutor.
  - P6242ed8d Juan de Guevara  [1703, 1715]  n=4  
      #3620: Doña Luisa de Abarca, viuda del Capitán don Antonio Pacheco, se obliga con el Capitán don Miguel Calvo, Patrono de la Capellanía fundada por

andres lopez de cespedes  (36 records → 3 persons; conflicts {'death': 4, 'lifespan': 34}; boundary evidence)
  - P82a09edb Andrés López de Céspedes  [1540, 1540]  n=2  
      #1309: El Capitán Rodrigo Calderón y su esposa Isidora Zambrano se obligaron por $100 a un censo del 5% al fondo de dotes para doncellas de la Cofr
  - P3b1da46f Andrés López de Céspedes  [1623, 1684]  n=30  {'military': 3}
      #218: Juan Fernández, Maese de Campo don Diego de Sojo, Capn. Juan de las Alas, Alférez Francisco Román, y Andrés López de Céspedes, todos residen
  - P1ae35994 Andrés López de Céspedes  [1702, 1710]  n=4  {'military': 1}
      #3513: El Capitán Juan de Bonilla, cabo gobernador de Talamanca, y su esposa doña Francisca de Astúa, se obligaron a la Capellanía fundada por Andr

alonso de porras  (28 records → 2 persons; conflicts {'lifespan': 1}; boundary evidence)
  - P41337719 Capitán Alonso de Porras  [1675, 1755]  n=27  cónyuge: ana de castro, ana rodriguez de castro  {'military': 16, 'don': 1}
      #2149: Se realizó un acuerdo incompleto entre el Capitán Bartolomé Muñoz y Hidalgo y Alonso de Porras.
  - P670f28be Don Alonso de Porras  [1800, 1800]  n=1  {'don': 1}
      #9828: Don Joaquín de Oreamuno se hizo cargo de dos capellanías: una de 600 pesos cacao fundada por Don Alonso de Porras, con el Sr. Vicario don Ra

ana micaela calvo  (4 records → 2 persons; conflicts {'lifespan': 1}; boundary evidence)
  - P7d5dcf33 Ana Micaela Calvo  [1684, 1734]  n=3  cónyuge: jose carranza  
      #4504: El Capitán José Carranza y su esposa Ana Micaela Calvo otorgan la libertad a su esclavo pardo, Juan, quien tiene más de 40 años. Ana Micaela
  - Pca38bf72 Ana Micaela Calvo  [1794, 1794]  n=1  
      #9189: Los hermanos José Miguel Alvarez y María Antonia Alvarez, con permiso de su esposo José Joaquín Coronel, venden media casa y medio solar por

=== MERGES (10 surest, 10 random ≥0.5) ===

0.99 spelling Nicolás de Figueroa  ↔  Nicolás Figueroa
      nombre 1.00 · mismos padres: adriano de figueroa · nacimiento ≈1655 / ≈1655 · años 1656–1671 y 1671–1671

0.99 spelling Doña María Francisca de Alvarado  ↔  Doña María Francisca Alvarado
      nombre 1.00 · mismo cónyuge: antonio de la fuente · años 1765–1816 y 1792–1808

0.99 spelling Doña Antonia María Venegas  ↔  Antonia María de Venegas
      nombre 1.00 · mismo cónyuge: bernardo sarmiento de sotomayor · años 1681–1742 y 1698–1698

0.99 spelling Magdalena de Sosa  ↔  Magdalena Sosa
      nombre 1.00 · mismo cónyuge: jose de amores · años 1720–1743 y 1743–1743

0.99 spelling Josefa de Santiago y Aguilar  ↔  Doña Josefa Santiago de Aguilar
      nombre 1.00 · mismo cónyuge: antonio de acosta arevalo · años 1678–1735 y 1695–1735

0.99 spelling Josefa de Santiago y Aguilar  ↔  Doña Josefa de Aguilar y Santiago
      nombre 1.00 · mismo cónyuge: antonio de acosta arevalo · años 1678–1735 y 1684–1753

0.99 spelling Doña Josefa Santiago de Aguilar  ↔  Doña Josefa de Aguilar y Santiago
      nombre 1.00 · mismo cónyuge: antonio de acosta arevalo · años 1695–1735 y 1684–1753

0.99 spelling Don Juan de Senabria Maldonado  ↔  Juan Senabria Maldonado
      nombre 1.00 · mismo cónyuge: juana moscoso · años 1621–1684 y 1670–1670

0.99 spelling Ignacio de Artavia  ↔  Ignacio Artavia
      nombre 1.00 · mismo cónyuge: catalina de la jara · años 1633–1694 y 1660–1661

0.99 spelling Juana Moscoso  ↔  Doña Juana de Moscoso
      nombre 1.00 · mismo cónyuge: juan de senabria maldonado · años 1647–1716 y 1665–1692

0.62 similar  Juan Rodríguez  ↔  Juan Gabriel Rodríguez
      nombre 0.90 · años 1794–1814 y 1807–1807

0.55 similar  Francisco Javier  ↔  Don Francisco Javier Villasanta
      nombre 0.90 · años 1816–1816 y 1804–1812 (sin solape)

0.62 similar  José González  ↔  José Lorenzo González
      nombre 0.90 · años 1740–1818 y 1761–1761

0.62 similar  Ana de Chaves  ↔  Ana Manuela de Chaves
      nombre 0.90 · años 1629–1713 y 1701–1701

0.62 similar  María Fernández  ↔  doña María Josefa Fernández Martínez
      nombre 0.90 · años 1687–1766 y 1765–1765

0.57 similar  José Joaquín Coronel Paniaona  ↔  José Joaquín Coronel
      nombre 0.90 · años 1779–1779 y 1780–1809 (sin solape)

0.57 similar  Pedro Solano  ↔  Pedro Solano (son)
      nombre 0.90 · años 1742–1757 y 1740–1741 (sin solape)

0.62 similar  doña Josefa Pérez de Muro  ↔  Josefa (daughter of José Pérez de Muro)
      nombre 0.90 · años 1703–1777 y 1713–1713

0.62 similar  Manuel Felipe  ↔  Manuel Felipe Jiménez
      nombre 0.90 · años 1727–1808 y 1777–1810

0.62 similar  José Antonio Brenes  ↔  José Brenes
      nombre 0.90 · años 1741–1822 y 1797–1817
```
