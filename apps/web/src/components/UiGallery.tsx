import { useState } from "react";
import {
  Button,
  Modal,
  Skeleton,
  SkeletonGroup,
  StatusBadge,
  Toast,
  type StatusBadgeStatus,
} from "./ui";
import styles from "./UiGallery.module.css";

const STATUSES: StatusBadgeStatus[] = ["neutral", "success", "danger", "warning", "info"];

/**
 * A small, always-visible showcase of the design-system primitives
 * (MPG-029-c) so they're exercised end-to-end (real tokens, real theming,
 * real a11y) rather than only living in isolated tests. Not a product
 * screen — real screens land in MPG-009+.
 */
export function UiGallery(): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [toastVisible, setToastVisible] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const handleSimulateLoading = (): void => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1200);
  };

  return (
    <section className={styles.gallery} aria-labelledby="ui-gallery-heading">
      <h2 id="ui-gallery-heading" className={styles.heading}>
        UI kit
      </h2>

      <div className={styles.group}>
        <h3 className={styles.groupHeading}>Buttons</h3>
        <div className={styles.row}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading={loading} onClick={handleSimulateLoading}>
            {loading ? "Saving" : "Simulate loading"}
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupHeading}>Status badges</h3>
        <div className={styles.row}>
          {STATUSES.map((status) => (
            <StatusBadge key={status} status={status}>
              {status}
            </StatusBadge>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupHeading}>Toast</h3>
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => setToastVisible(true)}>
            Show toast
          </Button>
        </div>
        {toastVisible ? (
          <div className={styles.toastSlot}>
            <Toast variant="success" onDismiss={() => setToastVisible(false)}>
              Move accepted — reconciled with the server.
            </Toast>
          </div>
        ) : null}
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupHeading}>Modal</h3>
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Open modal
          </Button>
        </div>
        <Modal isOpen={modalOpen} title="Rematch?" onClose={() => setModalOpen(false)}>
          <p className={styles.modalBody}>Play again with the same seats?</p>
          <div className={styles.row}>
            <Button onClick={() => setModalOpen(false)}>Rematch</Button>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Not now
            </Button>
          </div>
        </Modal>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupHeading}>Skeleton</h3>
        <SkeletonGroup label="Loading game list…" className={styles.skeletonGroup}>
          <Skeleton width="60%" />
          <Skeleton width="80%" />
          <Skeleton width="40%" />
        </SkeletonGroup>
      </div>
    </section>
  );
}
