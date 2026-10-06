import React, { useState, useEffect } from "react";
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonProgressBar,
  IonGrid,
  IonRow,
  IonCol,
  IonIcon,
} from "@ionic/react";
import { add, trash } from "ionicons/icons";
import { LocalNotifications } from "@capacitor/local-notifications";

interface ChargerConfig {
  id: string;
  type: string;
  currentMa: number;
}

interface AppState {
  chargerConfigs: ChargerConfig[];
  batteryCapacities: Record<string, number>;
  batteriesVMIN: Record<string, number>;
  batteriesVMAX: Record<string, number>;
  selectedType: string;
  batteryCount: number;
  batteryVoltages: number[];
  isConnected: boolean;
  startTime: number | null;
}

const STORAGE_KEY = "charger_app_state_v1";
const FACTOR_ERROR = 1.35;

export const Home: React.FC = () => {
  const [chargerConfigs, setChargerConfigs] = useState<ChargerConfig[]>([
    { id: "1", type: "AA", currentMa: 120 },
    { id: "2", type: "AAA", currentMa: 70 },
    { id: "3", type: "9V", currentMa: 16 },
  ]);

  const [batteryCapacities, setBatteryCapacities] = useState<
    Record<string, number>
  >({
    AA: 1300,
    AAA: 1100,
    "9V": 200,
  });

  const [batteriesVMIN, setBVMIN] = useState<Record<string, number>>({
    AA: 0.9,
    AAA: 0.9,
    "9V": 7.0,
  });

  const [batteriesVMAX, setBVMAX] = useState<Record<string, number>>({
    AA: 1.45,
    AAA: 1.45,
    "9V": 9.6,
  });

  const [selectedType, setSelectedType] = useState<string>("AA");
  const [batteryCount, setBatteryCount] = useState<number>(4);
  const [batteryVoltages, setBatteryVoltages] = useState<number[]>([
    0.9, 1.0, 1.1, 1.2,
  ]);

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [currentVoltages, setCurrentVoltages] =
    useState<number[]>(batteryVoltages);
  const [progresses, setProgresses] = useState<number[]>([0, 0, 0, 0]);
  const [maxRemainingHours, setMaxRemainingHours] = useState<number>(0);

  // Cargar estado inicial almacenado
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed: AppState = JSON.parse(saved);
        setChargerConfigs(parsed.chargerConfigs || []);
        setBatteryCapacities(parsed.batteryCapacities || {});
        setBVMIN(parsed.batteriesVMIN || {});
        setBVMAX(parsed.batteriesVMAX || {});
        setSelectedType(parsed.selectedType || "AAA");
        setBatteryCount(parsed.batteryCount || 1);
        setBatteryVoltages(parsed.batteryVoltages || [1.0]);
        setIsConnected(parsed.isConnected || false);
        setStartTime(parsed.startTime || null);
      } catch (e) {
        console.error("Error al cargar persistencia:", e);
      }
    }
    requestNotificationPermissions();
  }, []);

  // Guardar estado ante cualquier cambio
  useEffect(() => {
    const stateToSave: AppState = {
      chargerConfigs,
      batteryCapacities,
      batteriesVMIN,
      batteriesVMAX,
      selectedType,
      batteryCount,
      batteryVoltages,
      isConnected,
      startTime,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
  }, [
    chargerConfigs,
    batteryCapacities,
    batteriesVMIN,
    batteriesVMAX,
    selectedType,
    batteryCount,
    batteryVoltages,
    isConnected,
    startTime,
  ]);

  const requestNotificationPermissions = async () => {
    try {
      await LocalNotifications.requestPermissions();
    } catch (e) {
      console.log("Notificaciones no soportadas en web pura");
    }
  };

  // Ajustar número de voltajes al cambiar cantidad de baterías
  const handleCountChange = (count: number) => {
    setBatteryCount(count);
    const newVoltages = [...batteryVoltages];
    if (count > newVoltages.length) {
      for (let i = newVoltages.length; i < count; i++) {
        newVoltages.push(1.0);
      }
    } else {
      newVoltages.length = count;
    }
    setBatteryVoltages(newVoltages);
    setCurrentVoltages(newVoltages);
  };

  // Agregar y remover tipos de cargador
  const addChargerRow = () => {
    const newId = Date.now().toString();
    setChargerConfigs([
      ...chargerConfigs,
      { id: newId, type: "NUEVO", currentMa: 100 },
    ]);
  };

  const removeChargerRow = (id: string) => {
    const updated = chargerConfigs.filter((c) => c.id !== id);
    setChargerConfigs(updated);
  };

  const updateChargerConfig = (
    id: string,
    field: "type" | "currentMa",
    value: any,
  ) => {
    setChargerConfigs(
      chargerConfigs.map((item) => {
        if (item.id === id) {
          return { ...item, [field]: value };
        }
        return item;
      }),
    );
  };

  // Motor del temporizador y cálculo en tiempo real
  useEffect(() => {
    let interval: any = null;

    if (isConnected && startTime) {
      let enviada: boolean = false;
      interval = setInterval(async () => {
        const config = chargerConfigs.find((c) => c.type === selectedType);
        const currentMa = config ? config.currentMa : 100;
        const capacityMah = batteryCapacities[selectedType] || 1000;
        const elapsedHours = (Date.now() - startTime) / (1000 * 3600);

        let maxHoursLeft = 0;
        const nextVoltages: number[] = [];
        const nextProgresses: number[] = [];
        const V_MIN = batteriesVMIN[selectedType] || 0.9;
        const V_MAX = batteriesVMAX[selectedType] || 1.4;

        batteryVoltages.forEach((vInit) => {
          const clampedInit = Math.max(V_MIN, Math.min(V_MAX, vInit));
          const socInit = (clampedInit - V_MIN) / (V_MAX - V_MIN);
          const socInitTime = clampedInit / V_MAX;
          const totalChargingHoursNeeded =
            ((capacityMah * (1 - socInitTime)) / currentMa) * FACTOR_ERROR;

          const addedSoc =
            totalChargingHoursNeeded > 0
              ? (elapsedHours / totalChargingHoursNeeded) * (1 - socInit)
              : 1 - socInit;
          const currentSoc = Math.min(1.0, socInit + addedSoc);
          const vCurrent = V_MIN + currentSoc * (V_MAX - V_MIN);

          const hoursRemaining = Math.max(
            0,
            totalChargingHoursNeeded - elapsedHours,
          );
          if (hoursRemaining > maxHoursLeft) maxHoursLeft = hoursRemaining;

          nextVoltages.push(Number(vCurrent.toFixed(2)));
          nextProgresses.push(currentSoc);
        });

        setCurrentVoltages(nextVoltages);
        setProgresses(nextProgresses);
        setMaxRemainingHours(maxHoursLeft);

        if (!enviada) {
          await enviarNotificacion(maxHoursLeft);
          enviada = true;
        }
      }, 1000);
    } else {
      setCurrentVoltages([...batteryVoltages]);
      setProgresses(batteryVoltages.map(() => 0));
    }

    return () => clearInterval(interval);
  }, [
    isConnected,
    startTime,
    batteryVoltages,
    selectedType,
    chargerConfigs,
    batteryCapacities,
    batteriesVMIN,
    batteriesVMAX,
  ]);

  const enviarNotificacion = async (maxHoursLeft: number) => {
    const tiempo_str: string = `${Math.floor(maxHoursLeft)}h ${Math.round((maxHoursLeft % 1) * 60)}m`;

    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            title: "Carga de Baterías iniciada",
            body: `Tiempo estimado de carga restante: ${tiempo_str}`,
            id: 1,
            ongoing: true,
            autoCancel: false,
          },
        ],
      });
    } catch {
      console.log("Notificación local enviada localmente");
    }
  };

  const handleToggleConnect = async () => {
    if (!isConnected) {
      const now = Date.now();
      setStartTime(now);
      setIsConnected(true);
    } else {
      setIsConnected(false);
      setStartTime(null);
      setBatteryVoltages([...currentVoltages]);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="primary">
          <IonTitle>Cargador de Baterías Inteligente</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Sección 1: Datos del cargador */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Datos del Cargador</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonGrid>
              <IonRow style={{ fontWeight: "bold" }}>
                <IonCol>Tipo</IonCol>
                <IonCol>Corriente (mA)</IonCol>
                <IonCol size="2"></IonCol>
              </IonRow>
              {chargerConfigs.map((config) => (
                <IonRow key={config.id}>
                  <IonCol>
                    <IonInput
                      disabled={isConnected}
                      value={config.type}
                      onIonChange={(e) =>
                        updateChargerConfig(config.id, "type", e.detail.value!)
                      }
                    />
                  </IonCol>
                  <IonCol>
                    <IonInput
                      type="number"
                      disabled={isConnected}
                      value={config.currentMa}
                      onIonChange={(e) =>
                        updateChargerConfig(
                          config.id,
                          "currentMa",
                          Number(e.detail.value),
                        )
                      }
                    />
                  </IonCol>
                  <IonCol size="2">
                    <IonButton
                      color="danger"
                      fill="clear"
                      disabled={isConnected}
                      onClick={() => removeChargerRow(config.id)}
                    >
                      <IonIcon icon={trash} />
                    </IonButton>
                  </IonCol>
                </IonRow>
              ))}
            </IonGrid>
            <IonButton
              expand="block"
              fill="outline"
              disabled={isConnected}
              onClick={addChargerRow}
            >
              <IonIcon slot="start" icon={add} /> Agregar Tipo
            </IonButton>
          </IonCardContent>
        </IonCard>

        {/* Sección 2: Baterías actuales */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Capacidad de Baterías</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonGrid>
              <IonRow style={{ fontWeight: "bold" }}>
                <IonCol>Tipo</IonCol>
                <IonCol>Capacidad (mAh)</IonCol>
                <IonCol>V. Mín</IonCol>
                <IonCol>V. Máx</IonCol>
              </IonRow>
              {chargerConfigs.map((config) => (
                <IonRow key={config.id}>
                  <IonCol>{config.type}</IonCol>
                  <IonCol>
                    <IonInput
                      type="number"
                      step="1"
                      disabled={isConnected}
                      value={batteryCapacities[config.type] || 1000}
                      onIonChange={(e) =>
                        setBatteryCapacities({
                          ...batteryCapacities,
                          [config.type]: Number(e.detail.value),
                        })
                      }
                    />
                  </IonCol>
                  <IonCol>
                    <IonInput
                      type="number"
                      step="0.01"
                      disabled={isConnected}
                      value={batteriesVMIN[config.type] || 0.9}
                      onIonChange={(e) =>
                        setBVMIN({
                          ...batteriesVMIN,
                          [config.type]: Number(e.detail.value),
                        })
                      }
                    />
                  </IonCol>
                  <IonCol>
                    <IonInput
                      type="number"
                      step="0.01"
                      disabled={isConnected}
                      value={batteriesVMAX[config.type] || 1.4}
                      onIonChange={(e) =>
                        setBVMAX({
                          ...batteriesVMAX,
                          [config.type]: Number(e.detail.value),
                        })
                      }
                    />
                  </IonCol>
                </IonRow>
              ))}
            </IonGrid>
          </IonCardContent>
        </IonCard>

        {/* Sección 3: Configuración de Carga */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Configuración de Carga</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonItem>
              <IonLabel position="stacked">Tipo de Batería</IonLabel>
              <IonSelect
                disabled={isConnected}
                value={selectedType}
                onIonChange={(e) => setSelectedType(e.detail.value)}
              >
                {chargerConfigs.map((c) => (
                  <IonSelectOption key={c.id} value={c.type}>
                    {c.type}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>

            <IonItem>
              <IonLabel position="stacked">Cantidad de Baterías</IonLabel>
              <IonInput
                type="number"
                disabled={isConnected}
                value={batteryCount}
                onIonChange={(e) =>
                  handleCountChange(Math.max(1, Number(e.detail.value)))
                }
              />
            </IonItem>

            <div style={{ marginTop: "15px" }}>
              <h4>Nivel de Voltaje Actual</h4>
              {batteryVoltages.map((v, index) => (
                <div key={index} style={{ marginBottom: "12px" }}>
                  <IonItem>
                    <IonLabel>Batería #{index + 1} (V):</IonLabel>
                    <IonInput
                      type="number"
                      step="0.01"
                      disabled={isConnected}
                      value={isConnected ? currentVoltages[index] : v}
                      onIonChange={(e) => {
                        const newV = [...batteryVoltages];
                        newV[index] = Number(e.detail.value);
                        setBatteryVoltages(newV);
                      }}
                    />
                  </IonItem>
                  {isConnected && (
                    <div style={{ padding: "0 16px" }}>
                      <IonProgressBar
                        value={progresses[index]}
                        color="success"
                      />
                      <small>
                        Progreso: {Math.round(progresses[index] * 100)}%
                      </small>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {isConnected && (
              <div
                style={{
                  marginTop: "15px",
                  padding: "10px",
                  background: "#eef9ee",
                  borderRadius: "8px",
                }}
              >
                <strong>Tiempo estimado restante: </strong>
                {Math.floor(maxRemainingHours)}h{" "}
                {Math.round((maxRemainingHours % 1) * 60)}m
              </div>
            )}
          </IonCardContent>
        </IonCard>

        <IonButton
          expand="block"
          color="secondary"
          style={{ marginTop: "20px" }}
          disabled={!isConnected}
          onClick={() => enviarNotificacion(maxRemainingHours)}
        >
          Reenviar notificación
        </IonButton>

        {/* Botón Principal */}
        <IonButton
          expand="block"
          color={isConnected ? "danger" : "success"}
          style={{ marginTop: "20px" }}
          onClick={handleToggleConnect}
        >
          {isConnected ? "Desconectar" : "Conectar"}
        </IonButton>
      </IonContent>
    </IonPage>
  );
};

export default Home;
