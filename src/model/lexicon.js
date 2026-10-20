const set = (words) => new Set(words.split(/\s+/).filter(Boolean));

export const FIRST_NAMES = set(`maria jose juan luis carlos jorge pedro miguel andres david daniel santiago sebastian alejandro camilo felipe fernando ricardo roberto eduardo fabian gustavo hector hernan ivan jairo javier jesus julio mauricio nicolas oscar rafael ramon sergio victor william wilson alvaro armando cesar diego edgar edwin elkin fredy german guillermo harold hugo humberto jaime jhon john kevin leonardo manuel marco mario mateo nelson orlando pablo rodrigo samuel stiven tomas yesid danilo anibal arturo augusto bernardo cristian enrique ernesto francisco gerardo gilberto henry jhonatan jhoan lucas martin nestor omar pastor rene ruben tulio
ana laura paula sandra claudia diana carolina catalina daniela valentina sofia camila andrea natalia patricia luz martha marta gloria adriana alejandra angela beatriz blanca carmen cecilia clara consuelo dora elena esperanza eugenia fanny gabriela ines isabel jennifer johana jimena juliana karen katherine lina liliana lucia luisa margarita mariana marisol melissa mercedes monica nancy nubia olga pilar rocio rosa sara silvia sonia stella susana tatiana teresa vanessa veronica viviana yolanda yuliana zulma amparo ligia miriam leidy lady maribel yaneth angie paola lorena milena carmenza ruby rubiela ximena wendy yesica yeimy xiomara`);

export const HONORIFICS = set('senor senora senores sr sra srta senorita doctor doctora dr dra don dona abogado abogada ing ingeniero ingeniera arq arquitecto arquitecta lic licenciado licenciada');

export const STOP_WORDS = set(`el la los las un una arrendador arrendadora arrendatario arrendataria contratante contratista vendedor vendedora comprador compradora demandante demandado demandada cliente proveedor sociedad empresa compania parte partes clausula paragrafo articulo contrato juzgado juez jueza tribunal magistrado magistrada fiscal notaria notario secretario secretaria republica colombia cartagena bolivar identificado identificada cedula nit representante legal gerente director directora presidente apoderado apoderada poderdante deudor acreedor fiador codeudor propietario propietaria inquilino beneficiario cedente cesionario comodante comodatario mandante mandatario testigo notificaciones anexo anexos fecha firma firmas ciudad direccion telefono correo email centro comercial`);

export const NOT_NAMES = set('colombia cartagena bogota medellin cali barranquilla bolivar dios');
export const CONNECTORS = set('de del la las los y e van von');
export const ORG_CONNECTORS = set('de del la las los y e &');
export const ORG_PREFIXES = set('banco fundacion corporacion clinica hospital universidad cooperativa inmobiliaria constructora almacenes grupo asociacion colegio instituto laboratorio droguerias drogueria ferreteria restaurante hotel');

// Nombres propios (proyectos, edificios, fincas, marcas…): listas para separar un nombre de una palabra común.
// Palabras que anuncian un nombre: «el proyecto Altamira», «la finca La Esperanza», «Conjunto Mirador del Río».
export const NAME_CUES = set(`centro proyecto proyectos programa plan operacion conjunto urbanizacion edificio torre finca hacienda predio lote marca
plataforma software sistema fondo aplicacion app parcelacion condominio vereda corregimiento sede club parque complejo residencial residencias
comercial establecimiento restaurante hotel hostal granja parcela bodega galpon taller cafe tienda almacen agencia portal campana evento festival`);

// Instituciones, normas y cargos: si el nombre empieza así, es una institución o una norma, no un dato de alguien.
export const INSTITUTION_WORDS = set(`juzgado juzgados tribunal tribunales corte cortes consejo sala salas fiscalia procuraduria contraloria defensoria personeria
ley leyes decreto decretos resolucion resoluciones acuerdo circular sentencia auto articulo articulos paragrafo clausula codigo constitucion estatuto
republica estado nacion ministerio superintendencia camara notaria registraduria alcaldia gobernacion secretaria direccion departamento municipio
distrito rama congreso senado policia ejercito armada fuerza fuerzas oficina despacho unidad comision agencia instituto honorable magistratura
jurisdiccion comisaria inspeccion dian sena icbf`);

// Palabras comunes que en documentos legales suelen ir con mayúscula (términos definidos, cargos, fechas).
export const COMMON_CAPS = set(`inmueble inmuebles contrato contratos parte partes canon precio objeto plazo garantia poliza servicio servicios bienes obra obras
interventor interventoria supervisor entidad oferente propuesta pliego otrosi acta actas adenda documento documentos informacion confidencial convenio
usuario usuarios trabajador trabajadora empleador empleadora accionista accionistas socio socios junta asamblea directiva comite gerencia representante
pagare letra cheque factura facturas cuenta tasa interes intereses mora multa penal arbitramento conciliacion territorio nacional municipal departamental
distrital publico publica general especial superior civil laboral administrativo administrativa contencioso familia comercio circuito tercero tercera
primero primera segundo segunda cuarto cuarta quinto quinta sexto sexta septimo septima octavo octava noveno novena decimo decima unico unica
radicado expediente proceso folio folios demanda recurso apelacion casacion tutela accion medida cautelar audiencia diligencia providencia fallo
considerando considerandos resuelve antecedentes hechos pretensiones pruebas fundamentos decision notifiquese cumplase publiquese
usted ustedes senoria excelencia dios santo santa san virgen
lunes martes miercoles jueves viernes sabado domingo enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre
pesos dolares euros moneda legal vigente iva pagina paginas hoja hojas
calle calles carrera carreras avenida diagonal transversal circular kilometro manzana casa apartamento apto local piso bloque etapa interior via autopista`);

// Al comienzo de una frase casi cualquier palabra va con mayúscula: estas nunca son nombres.
export const SENTENCE_STARTERS = set(`para por con sin mediante conforme segun durante desde hasta cuando como donde si no que este esta estos estas ese esa
dicho dicha dichos dichas cada todo toda todos todas ninguno ninguna ademas asimismo igualmente finalmente luego despues antes entonces tambien
en a al de del se lo le les su sus mi nuestro nuestra vencido vencida una vez obra consta visto vistos teniendo habiendo siendo respecto frente
aunque pero sino mientras porque pues bien otro otra otros otras tal tales dentro fuera ante bajo sobre tras entre hacia contra quien quienes cual cuales
hoy ayer manana ahora aqui alli asi ya aun solo mas menos muy primero segundo tercero ultimo ultima igual mismo misma`);

// Países y ciudades grandes: se detectan aparte (tipo LUGAR), apagados por defecto.
export const PLACES = set(`colombia venezuela ecuador peru brasil bolivia chile argentina uruguay paraguay panama mexico guatemala honduras nicaragua
costa rica cuba espana francia italia alemania portugal inglaterra canada china japon estados unidos america europa
bogota medellin cali barranquilla cartagena bucaramanga cucuta pereira manizales ibague villavicencio pasto monteria neiva armenia popayan
sincelejo valledupar tunja riohacha quibdo florencia yopal leticia soacha bello itagui envigado soledad palmira buenaventura tulua
santa marta indias caribe antioquia cundinamarca valle cauca atlantico bolivar santander boyaca narino cordoba huila
tolima meta caldas risaralda quindio sucre magdalena guajira choco caqueta casanare putumayo arauca amazonas guaviare vaupes vichada
miami madrid nueva york panama`);
